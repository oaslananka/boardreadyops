import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_SLO_POLICY_VERSION,
  createControlPlaneSloEvaluator,
} from "../../../apps/web/lib/control-plane-slo.js";
import type { ControlPlaneSliSnapshot } from "../../../packages/db/src/control-plane-operations-store.js";

function snapshot(overrides: Partial<ControlPlaneSliSnapshot> = {}): ControlPlaneSliSnapshot {
  return {
    webhookAcceptanceP95Ms: 0,
    lifecycleQueueAgeSeconds: 0,
    outboxLagSeconds: 0,
    dispatchLatencyP95Seconds: 0,
    completionLatencyP95Seconds: 0,
    staleAttempts: 0,
    reconciliationBacklog: 0,
    reconciliationRepairs24h: 0,
    terminalFailures24h: 0,
    terminalRuns24h: 0,
    terminalFailureRateBasisPoints: 0,
    ...overrides,
  };
}

function at(value: string): Date {
  return new Date(value);
}

describe("control-plane SLO evaluator", () => {
  it("reports a healthy aggregate snapshot without transitions", () => {
    const evaluator = createControlPlaneSloEvaluator();

    expect(evaluator.evaluate(snapshot(), at("2026-07-23T18:00:00.000Z"))).toEqual({
      policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
      healthy: true,
      activeSignals: [],
      events: [],
    });
  });

  it("fires a sustained lifecycle queue alert once and emits one recovery", () => {
    const evaluator = createControlPlaneSloEvaluator();
    const breached = snapshot({ lifecycleQueueAgeSeconds: 61 });

    expect(evaluator.evaluate(breached, at("2026-07-23T18:00:00.000Z")).events).toEqual([]);
    expect(evaluator.evaluate(breached, at("2026-07-23T18:04:59.000Z")).events).toEqual([]);

    const firing = evaluator.evaluate(breached, at("2026-07-23T18:05:00.000Z"));
    expect(firing.healthy).toBe(false);
    expect(firing.activeSignals).toEqual(["lifecycle_queue_age"]);
    expect(firing.events).toEqual([
      {
        policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
        signal: "lifecycle_queue_age",
        state: "firing",
        severity: "critical",
        observedValue: 61,
        threshold: 60,
        observedAt: "2026-07-23T18:05:00.000Z",
        reasonCode: "lifecycle_queue_age_sustained",
      },
    ]);

    expect(evaluator.evaluate(breached, at("2026-07-23T18:06:00.000Z")).events).toEqual([]);

    const recovered = evaluator.evaluate(snapshot(), at("2026-07-23T18:06:30.000Z"));
    expect(recovered.healthy).toBe(true);
    expect(recovered.events).toEqual([
      {
        policyVersion: CONTROL_PLANE_SLO_POLICY_VERSION,
        signal: "lifecycle_queue_age",
        state: "recovered",
        severity: "critical",
        observedValue: 0,
        threshold: 60,
        observedAt: "2026-07-23T18:06:30.000Z",
        reasonCode: "lifecycle_queue_age_sustained",
      },
    ]);
  });

  it.each([
    {
      signal: "webhook_acceptance_p95",
      breached: snapshot({ webhookAcceptanceP95Ms: 1_001 }),
      durationMilliseconds: 5 * 60 * 1_000,
      observedValue: 1_001,
      threshold: 1_000,
      severity: "warning",
      reasonCode: "webhook_acceptance_p95_sustained",
    },
    {
      signal: "outbox_lag",
      breached: snapshot({ outboxLagSeconds: 61 }),
      durationMilliseconds: 5 * 60 * 1_000,
      observedValue: 61,
      threshold: 60,
      severity: "critical",
      reasonCode: "outbox_lag_sustained",
    },
    {
      signal: "dispatch_latency_p95",
      breached: snapshot({ dispatchLatencyP95Seconds: 31 }),
      durationMilliseconds: 10 * 60 * 1_000,
      observedValue: 31,
      threshold: 30,
      severity: "warning",
      reasonCode: "dispatch_latency_p95_sustained",
    },
    {
      signal: "completion_latency_p95",
      breached: snapshot({ completionLatencyP95Seconds: 1_801 }),
      durationMilliseconds: 10 * 60 * 1_000,
      observedValue: 1_801,
      threshold: 1_800,
      severity: "warning",
      reasonCode: "completion_latency_p95_sustained",
    },
  ] as const)("pins the $signal sustained policy", (policy) => {
    const evaluator = createControlPlaneSloEvaluator();
    const startedAt = at("2026-07-23T18:00:00.000Z");

    expect(evaluator.evaluate(policy.breached, startedAt).events).toEqual([]);
    expect(
      evaluator.evaluate(policy.breached, new Date(startedAt.valueOf() + policy.durationMilliseconds - 1)).events,
    ).toEqual([]);
    expect(
      evaluator.evaluate(policy.breached, new Date(startedAt.valueOf() + policy.durationMilliseconds)).events,
    ).toEqual([
      expect.objectContaining({
        signal: policy.signal,
        state: "firing",
        severity: policy.severity,
        observedValue: policy.observedValue,
        threshold: policy.threshold,
        reasonCode: policy.reasonCode,
      }),
    ]);
  });

  it("requires two consecutive stale-attempt snapshots", () => {
    const evaluator = createControlPlaneSloEvaluator();

    expect(evaluator.evaluate(snapshot({ staleAttempts: 1 }), at("2026-07-23T18:00:00.000Z")).events).toEqual([]);
    expect(evaluator.evaluate(snapshot({ staleAttempts: 2 }), at("2026-07-23T18:00:30.000Z")).events).toEqual([
      expect.objectContaining({
        signal: "stale_attempts",
        state: "firing",
        observedValue: 2,
        threshold: 0,
        reasonCode: "stale_attempts_consecutive",
      }),
    ]);
  });

  it("fires when reconciliation backlog increases across three snapshots or exceeds twenty", () => {
    const trendEvaluator = createControlPlaneSloEvaluator();

    expect(
      trendEvaluator.evaluate(snapshot({ reconciliationBacklog: 5 }), at("2026-07-23T18:00:00.000Z")).events,
    ).toEqual([]);
    expect(
      trendEvaluator.evaluate(snapshot({ reconciliationBacklog: 6 }), at("2026-07-23T18:00:30.000Z")).events,
    ).toEqual([]);
    expect(
      trendEvaluator.evaluate(snapshot({ reconciliationBacklog: 7 }), at("2026-07-23T18:01:00.000Z")).events,
    ).toEqual([
      expect.objectContaining({
        signal: "reconciliation_backlog",
        state: "firing",
        observedValue: 7,
        threshold: 20,
        reasonCode: "reconciliation_backlog_increasing",
      }),
    ]);

    const thresholdEvaluator = createControlPlaneSloEvaluator();
    expect(
      thresholdEvaluator.evaluate(snapshot({ reconciliationBacklog: 21 }), at("2026-07-23T18:00:00.000Z")).events,
    ).toEqual([
      expect.objectContaining({
        signal: "reconciliation_backlog",
        state: "firing",
        reasonCode: "reconciliation_backlog_threshold",
      }),
    ]);
  });

  it("requires minimum terminal volume before failure-rate alerting", () => {
    const evaluator = createControlPlaneSloEvaluator();

    expect(
      evaluator.evaluate(
        snapshot({ terminalRuns24h: 19, terminalFailures24h: 2, terminalFailureRateBasisPoints: 1_053 }),
        at("2026-07-23T18:00:00.000Z"),
      ).events,
    ).toEqual([]);

    expect(
      evaluator.evaluate(
        snapshot({ terminalRuns24h: 20, terminalFailures24h: 2, terminalFailureRateBasisPoints: 1_000 }),
        at("2026-07-23T18:00:30.000Z"),
      ).events,
    ).toEqual([
      expect.objectContaining({
        signal: "terminal_failure_rate",
        state: "firing",
        severity: "critical",
        observedValue: 1_000,
        threshold: 500,
        reasonCode: "terminal_failure_rate_exceeded",
      }),
    ]);
  });
});
