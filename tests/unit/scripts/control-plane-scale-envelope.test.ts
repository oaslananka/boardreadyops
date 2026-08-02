import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_SCALE_PRESETS,
  controlPlaneScaleEnvironment,
  summarizeControlPlaneScaleEnvelope,
} from "../../../scripts/control-plane-scale-envelope.mjs";

function measurement(p95Ms: number, throughputPerSecond: number) {
  return {
    count: 10,
    elapsedMs: 100,
    throughputPerSecond,
    p50Ms: p95Ms / 2,
    p95Ms,
    p99Ms: p95Ms + 5,
    maximumMs: p95Ms + 10,
  };
}

function report(preset: keyof typeof CONTROL_PLANE_SCALE_PRESETS, p95Ms: number) {
  const scenario = CONTROL_PLANE_SCALE_PRESETS[preset];
  const releaseRuns = scenario.repositoryCount * scenario.runsPerRepository;
  return {
    event: "control_plane_load_verified" as const,
    scenario: { profile: "representative" as const, recoveryRounds: 3, ...scenario },
    intake: measurement(p95Ms, 1_000),
    lifecycle: measurement(p95Ms + 10, 900),
    dashboard: measurement(p95Ms - 10, 200),
    invariants: {
      acceptedDeliveries: scenario.uniqueDeliveries,
      duplicateDeliveries: scenario.duplicateDeliveries,
      completedJobs: scenario.uniqueDeliveries,
      releaseRuns,
      completedOutboxEffects: releaseRuns,
      scopedDashboardReads: scenario.repositoryCount * 2,
      crossTenantMismatches: 0,
    },
    signals: [] as string[],
  };
}

describe("control-plane scale presets", () => {
  it("exposes the measured baseline, medium, and high tiers", () => {
    expect(CONTROL_PLANE_SCALE_PRESETS).toEqual({
      baseline: {
        uniqueDeliveries: 200,
        duplicateDeliveries: 50,
        repositoryCount: 4,
        runsPerRepository: 20,
        concurrency: 20,
      },
      medium: {
        uniqueDeliveries: 500,
        duplicateDeliveries: 100,
        repositoryCount: 8,
        runsPerRepository: 30,
        concurrency: 40,
      },
      high: {
        uniqueDeliveries: 1_000,
        duplicateDeliveries: 200,
        repositoryCount: 12,
        runsPerRepository: 50,
        concurrency: 80,
      },
    });
  });

  it("renders only fixed load environment values for a selected tier", () => {
    expect(controlPlaneScaleEnvironment("high")).toEqual({
      BOARDREADYOPS_LOAD_PROFILE: "representative",
      BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES: "1000",
      BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES: "200",
      BOARDREADYOPS_LOAD_REPOSITORIES: "12",
      BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY: "50",
      BOARDREADYOPS_LOAD_CONCURRENCY: "80",
    });
    expect(() => controlPlaneScaleEnvironment("unknown")).toThrow("unknown control-plane scale preset");
  });
});

describe("control-plane scale envelope summary", () => {
  it("accepts exact, signal-free tier reports and emits aggregate-only evidence", () => {
    const summary = summarizeControlPlaneScaleEnvelope(
      {
        baseline: report("baseline", 60),
        medium: report("medium", 80),
        high: report("high", 120),
      },
      { sourceSha: "f".repeat(40) },
    );

    expect(summary).toMatchObject({
      event: "control_plane_scale_envelope_verified",
      sourceSha: "f".repeat(40),
      envelope: {
        maximumUniqueDeliveries: 1_000,
        maximumReleaseRuns: 600,
        maximumConcurrency: 80,
        maximumDatabasePoolSize: 50,
        maximumObservedP95Ms: 130,
        crossTenantMismatches: 0,
        thresholdSignals: 0,
      },
    });
    expect(summary.tiers.map((tier) => tier.preset)).toEqual(["baseline", "medium", "high"]);
    expect(JSON.stringify(summary)).not.toContain("DATABASE_URL");
  });

  it("fails closed on scenario drift, signals, or tenant mismatches", () => {
    const baseline = report("baseline", 60);
    const medium = report("medium", 80);
    const high = report("high", 120);

    expect(() =>
      summarizeControlPlaneScaleEnvelope({
        baseline: { ...baseline, scenario: { ...baseline.scenario, concurrency: 21 } },
        medium,
        high,
      }),
    ).toThrow("baseline scale report scenario did not match its preset");

    expect(() =>
      summarizeControlPlaneScaleEnvelope({
        baseline,
        medium: { ...medium, signals: ["lifecycle_p95_exceeded"] },
        high,
      }),
    ).toThrow("medium scale report contained threshold signals");

    expect(() =>
      summarizeControlPlaneScaleEnvelope({
        baseline,
        medium,
        high: { ...high, invariants: { ...high.invariants, crossTenantMismatches: 1 } },
      }),
    ).toThrow("high scale report invariants did not converge");
  });
});
