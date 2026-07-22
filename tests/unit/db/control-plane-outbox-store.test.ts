import { describe, expect, it } from "vitest";
import { createSqlControlPlaneOutboxStore } from "../../../packages/db/src/control-plane-outbox-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const checkRunPayload = {
  version: 1 as const,
  type: "github.check_run.create" as const,
  action: {
    type: "release_run.enqueue" as const,
    installation: { id: 1 },
    repository: {
      id: 2,
      owner: "octo",
      name: "repo",
      fullName: "octo/repo",
      private: false,
      defaultBranch: "main",
    },
    commitSha: "a".repeat(40),
    ref: "refs/pull/1/head",
    pullRequestNumber: 1,
    pullRequestDraft: false,
    pullRequestFromFork: false,
    triggerKind: "pull_request" as const,
  },
  runId: "run-1",
  idempotencyKey: "repository:1:sha",
};

describe("control-plane outbox store", () => {
  it("claims and decodes bounded typed effects", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_claim_control_plane_outbox");
        expect(params?.[0]).toBe("worker-1");
        expect(params?.[3]).toBe(4);
        return {
          rows: [
            {
              outbox_id: "outbox-1",
              release_run_id: "run-1",
              execution_attempt_id: null,
              effect_type: "github.check_run.create",
              payload_version: 1,
              idempotency_key: "github.check_run.create:run-1",
              payload: checkRunPayload,
              attempt_count: 2,
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOutboxStore(executor, {
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      leaseSeconds: 90,
    });

    await expect(store.claimEffects({ workerId: "worker-1", limit: 4 })).resolves.toEqual([
      {
        outboxId: "outbox-1",
        releaseRunId: "run-1",
        effectType: "github.check_run.create",
        payloadVersion: 1,
        idempotencyKey: "github.check_run.create:run-1",
        payload: checkRunPayload,
        attemptCount: 2,
      },
    ]);
  });

  it("rejects a payload whose discriminator disagrees with the row", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return {
          rows: [
            {
              outbox_id: "outbox-1",
              effect_type: "github.workflow.dispatch",
              payload_version: 1,
              idempotency_key: "key",
              payload: checkRunPayload,
              attempt_count: 1,
            },
          ],
        };
      },
    };

    await expect(
      createSqlControlPlaneOutboxStore(executor).claimEffects({ workerId: "worker-1" }),
    ).rejects.toThrow("outbox effect payload did not match its row");
  });

  it("marks network delivery before issuing an external call", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_mark_control_plane_outbox_delivery_started");
        expect(params?.slice(0, 2)).toEqual(["outbox-1", "worker-1"]);
        return { rows: [{ outcome: "started" }] };
      },
    };
    const store = createSqlControlPlaneOutboxStore(executor);

    await expect(
      store.markDeliveryStarted({ outboxId: "outbox-1", workerId: "worker-1" }),
    ).resolves.toBe("started");
  });

  it("classifies uncertain delivery without exposing credentials", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return { rows: [{ outcome: "reconciliation_required" }] };
      },
    };
    const store = createSqlControlPlaneOutboxStore(executor, {
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    await expect(
      store.failEffect({
        outboxId: "outbox-1",
        workerId: "worker-1",
        errorClass: "NetworkError",
        errorMessage: `authorization=Bearer-${"x".repeat(1200)}`,
        deliveryUncertain: true,
      }),
    ).resolves.toBe("reconciliation_required");
    expect(calls[0]?.sql).toContain("boardreadyops_fail_control_plane_outbox");
    expect(String(calls[0]?.params[5])).not.toContain("authorization=");
    expect(String(calls[0]?.params[5]).length).toBeLessThanOrEqual(1000);
    expect(calls[0]?.params[6]).toBe(true);
  });

  it("collects queue and reconciliation metrics without tenant dimensions", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql) {
        expect(sql).toContain("reconciliation_required_effects");
        expect(sql).toContain("outbox_lag_seconds");
        return {
          rows: [
            {
              available_effects: 5,
              leased_effects: 2,
              dead_letter_effects: 1,
              reconciliation_required_effects: 3,
              retrying_effects: 4,
              oldest_available_age_seconds: 41,
              outbox_lag_seconds: 17,
            },
          ],
        };
      },
    };

    await expect(createSqlControlPlaneOutboxStore(executor).collectMetrics()).resolves.toEqual({
      availableEffects: 5,
      leasedEffects: 2,
      deadLetterEffects: 1,
      reconciliationRequiredEffects: 3,
      retryingEffects: 4,
      oldestAvailableAgeSeconds: 41,
      outboxLagSeconds: 17,
    });
  });
});
