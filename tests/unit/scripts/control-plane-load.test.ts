import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_LOAD_CONFIRMATION,
  evaluateControlPlaneLoadReport,
  mapWithConcurrency,
  parseControlPlaneLoadConfiguration,
  percentile,
  summarizeDurations,
  syntheticCommitSha,
} from "../../../scripts/control-plane-load.mjs";

const databaseUrl = "postgresql://load_user:load-secret@127.0.0.1:5432/boardreadyops_load";

function configuredEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: databaseUrl,
    BOARDREADYOPS_LOAD_CONFIRMATION: CONTROL_PLANE_LOAD_CONFIRMATION,
    ...overrides,
  };
}

describe("control-plane load configuration", () => {
  it("uses a bounded engineering baseline by default", () => {
    expect(parseControlPlaneLoadConfiguration(configuredEnvironment())).toEqual({
      databaseUrl,
      uniqueDeliveries: 200,
      duplicateDeliveries: 50,
      repositoryCount: 4,
      runsPerRepository: 20,
      concurrency: 20,
      thresholds: {
        intakeP95Ms: 1_000,
        lifecycleP95Ms: 1_500,
        dashboardP95Ms: 1_000,
        minimumThroughputPerSecond: 10,
      },
    });
  });

  it("accepts explicit bounded scenario and threshold overrides", () => {
    expect(
      parseControlPlaneLoadConfiguration(
        configuredEnvironment({
          BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES: "500",
          BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES: "125",
          BOARDREADYOPS_LOAD_REPOSITORIES: "8",
          BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY: "30",
          BOARDREADYOPS_LOAD_CONCURRENCY: "40",
          BOARDREADYOPS_LOAD_INTAKE_P95_MS: "750",
          BOARDREADYOPS_LOAD_LIFECYCLE_P95_MS: "1200",
          BOARDREADYOPS_LOAD_DASHBOARD_P95_MS: "500",
          BOARDREADYOPS_LOAD_MINIMUM_THROUGHPUT_PER_SECOND: "25",
        }),
      ),
    ).toEqual({
      databaseUrl,
      uniqueDeliveries: 500,
      duplicateDeliveries: 125,
      repositoryCount: 8,
      runsPerRepository: 30,
      concurrency: 40,
      thresholds: {
        intakeP95Ms: 750,
        lifecycleP95Ms: 1_200,
        dashboardP95Ms: 500,
        minimumThroughputPerSecond: 25,
      },
    });
  });

  it("requires a disposable database confirmation and valid bounded integers", () => {
    expect(() =>
      parseControlPlaneLoadConfiguration({
        DATABASE_URL: databaseUrl,
        BOARDREADYOPS_LOAD_CONFIRMATION: "yes",
      }),
    ).toThrow("isolated load-test confirmation is required");

    expect(() =>
      parseControlPlaneLoadConfiguration(configuredEnvironment({ BOARDREADYOPS_LOAD_CONCURRENCY: "0" })),
    ).toThrow("BOARDREADYOPS_LOAD_CONCURRENCY must be an integer between 1 and 100");

    expect(() =>
      parseControlPlaneLoadConfiguration(
        configuredEnvironment({
          BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES: "20",
          BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES: "21",
        }),
      ),
    ).toThrow("duplicate deliveries cannot exceed unique deliveries");
  });
});

describe("control-plane synthetic commit identifiers", () => {
  it("derives deterministic 40-character identifiers without SHA-1", () => {
    const first = syntheticCommitSha("scenario", 2, 7);
    const second = syntheticCommitSha("scenario", 2, 7);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{40}$/u);
    expect(first).toBe("4eb1b82ef1d54b9ecbfb88e099d34b2b91a11914");
  });
});

describe("control-plane load measurements", () => {
  it("computes nearest-rank percentiles and stable summaries", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(summarizeDurations([5, 1, 3, 2, 4], 10)).toEqual({
      count: 5,
      elapsedMs: 10,
      throughputPerSecond: 500,
      p50Ms: 3,
      p95Ms: 5,
      p99Ms: 5,
      maximumMs: 5,
    });
  });

  it("bounds asynchronous concurrency while preserving result order", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([6, 2, 4, 8]);
    expect(maximumActive).toBe(2);
  });

  it("rejects latency or throughput regressions with stable signal names", () => {
    const report = {
      event: "control_plane_load_verified" as const,
      scenario: {
        uniqueDeliveries: 200,
        duplicateDeliveries: 50,
        repositoryCount: 4,
        runsPerRepository: 20,
        concurrency: 20,
      },
      intake: {
        count: 250,
        elapsedMs: 2_000,
        throughputPerSecond: 125,
        p50Ms: 20,
        p95Ms: 1_100,
        p99Ms: 1_400,
        maximumMs: 1_500,
      },
      lifecycle: {
        count: 280,
        elapsedMs: 4_000,
        throughputPerSecond: 70,
        p50Ms: 50,
        p95Ms: 900,
        p99Ms: 1_200,
        maximumMs: 1_300,
      },
      dashboard: {
        count: 4,
        elapsedMs: 4_000,
        throughputPerSecond: 1,
        p50Ms: 100,
        p95Ms: 1_100,
        p99Ms: 1_100,
        maximumMs: 1_100,
      },
      invariants: {
        acceptedDeliveries: 200,
        duplicateDeliveries: 50,
        completedJobs: 200,
        releaseRuns: 80,
        completedOutboxEffects: 80,
        scopedDashboardReads: 4,
        crossTenantMismatches: 0,
      },
    };

    expect(
      evaluateControlPlaneLoadReport(report, {
        intakeP95Ms: 1_000,
        lifecycleP95Ms: 1_500,
        dashboardP95Ms: 1_000,
        minimumThroughputPerSecond: 10,
      }),
    ).toEqual(["intake_p95_exceeded", "dashboard_p95_exceeded", "dashboard_throughput_below_minimum"]);
  });
});
