import { describe, expect, it } from "vitest";
import {
  evaluateProductionSoakReport,
  ProductionSoakError,
  readProductionSoakOptions,
  runProductionSoakMonitor,
} from "../../../scripts/control-plane-production-soak.mjs";

function configuredEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    BOARDREADYOPS_SOAK_ORIGIN: "https://boardreadyops.oaslananka.dev",
    ...overrides,
  };
}

describe("production soak configuration", () => {
  it("uses a bounded four-hour baseline by default", () => {
    expect(readProductionSoakOptions(configuredEnvironment())).toEqual({
      origin: "https://boardreadyops.oaslananka.dev",
      readyPath: "/api/health/ready",
      durationMinutes: 240,
      intervalSeconds: 60,
      requestTimeoutMs: 10_000,
      maxConsecutiveFailures: 3,
      reportPath: undefined,
      thresholds: {
        latencyP95Ms: 2_000,
        minimumAvailabilityPercent: 99,
      },
    });
  });

  it("accepts explicit bounded overrides", () => {
    expect(
      readProductionSoakOptions(
        configuredEnvironment({
          BOARDREADYOPS_SOAK_DURATION_MINUTES: "30",
          BOARDREADYOPS_SOAK_INTERVAL_SECONDS: "10",
          BOARDREADYOPS_SOAK_REQUEST_TIMEOUT_MS: "5000",
          BOARDREADYOPS_SOAK_MAX_CONSECUTIVE_FAILURES: "2",
          BOARDREADYOPS_SOAK_LATENCY_P95_MS: "500",
          BOARDREADYOPS_SOAK_MINIMUM_AVAILABILITY_PERCENT: "95",
          BOARDREADYOPS_SOAK_REPORT_PATH: "soak-report.json",
        }),
      ),
    ).toEqual({
      origin: "https://boardreadyops.oaslananka.dev",
      readyPath: "/api/health/ready",
      durationMinutes: 30,
      intervalSeconds: 10,
      requestTimeoutMs: 5_000,
      maxConsecutiveFailures: 2,
      reportPath: "soak-report.json",
      thresholds: {
        latencyP95Ms: 500,
        minimumAvailabilityPercent: 95,
      },
    });
  });

  it("requires an HTTPS bare origin", () => {
    expect(() => readProductionSoakOptions(configuredEnvironment({ BOARDREADYOPS_SOAK_ORIGIN: undefined }))).toThrow(
      "BOARDREADYOPS_SOAK_ORIGIN is required",
    );
    expect(() =>
      readProductionSoakOptions(configuredEnvironment({ BOARDREADYOPS_SOAK_ORIGIN: "http://insecure.example" })),
    ).toThrow("BOARDREADYOPS_SOAK_ORIGIN must be an HTTPS origin");
    expect(() =>
      readProductionSoakOptions(
        configuredEnvironment({ BOARDREADYOPS_SOAK_ORIGIN: "https://boardreadyops.oaslananka.dev/extra" }),
      ),
    ).toThrow("BOARDREADYOPS_SOAK_ORIGIN must be an HTTPS origin");
  });

  it("rejects out-of-bounds duration and interval values", () => {
    expect(() =>
      readProductionSoakOptions(configuredEnvironment({ BOARDREADYOPS_SOAK_DURATION_MINUTES: "1" })),
    ).toThrow("BOARDREADYOPS_SOAK_DURATION_MINUTES must be an integer between 5 and 720");
    expect(() =>
      readProductionSoakOptions(configuredEnvironment({ BOARDREADYOPS_SOAK_INTERVAL_SECONDS: "1" })),
    ).toThrow("BOARDREADYOPS_SOAK_INTERVAL_SECONDS must be an integer between 5 and 900");
  });
});

describe("production soak report evaluation", () => {
  const thresholds = { latencyP95Ms: 2_000, minimumAvailabilityPercent: 99 };

  function baseReport(overrides: Record<string, unknown> = {}) {
    return {
      event: "control_plane_production_soak_verified" as const,
      scenario: {
        origin: "https://boardreadyops.oaslananka.dev",
        durationRequestedMinutes: 240,
        intervalSeconds: 60,
        maxConsecutiveFailures: 3,
      },
      samplesTaken: 240,
      elapsedMinutes: 240,
      terminatedEarly: false,
      ready: {
        count: 240,
        elapsedMs: 14_400_000,
        throughputPerSecond: 0.017,
        p50Ms: 40,
        p95Ms: 90,
        p99Ms: 120,
        maximumMs: 150,
      },
      availability: { successCount: 240, samplesTaken: 240, availabilityPercent: 100 },
      ...overrides,
    };
  }

  it("accepts a fully converged soak run with no signals", () => {
    expect(evaluateProductionSoakReport(baseReport(), thresholds)).toEqual([]);
  });

  it("flags early termination", () => {
    expect(
      evaluateProductionSoakReport(baseReport({ terminatedEarly: true, terminationReason: "x" }), thresholds),
    ).toEqual(["soak_terminated_early"]);
  });

  it("flags an incomplete soak duration", () => {
    expect(evaluateProductionSoakReport(baseReport({ elapsedMinutes: 100 }), thresholds)).toEqual([
      "soak_duration_incomplete",
    ]);
  });

  it("flags a latency p95 breach", () => {
    expect(
      evaluateProductionSoakReport(baseReport({ ready: { ...baseReport().ready, p95Ms: 5_000 } }), thresholds),
    ).toEqual(["soak_latency_p95_exceeded"]);
  });

  it("flags availability below the configured minimum", () => {
    expect(
      evaluateProductionSoakReport(
        baseReport({ availability: { successCount: 200, samplesTaken: 240, availabilityPercent: 83.33 } }),
        thresholds,
      ),
    ).toEqual(["soak_availability_below_minimum"]);
  });
});

describe("production soak monitor orchestration", () => {
  it("samples the ready endpoint at the configured interval until the duration elapses", async () => {
    const options = {
      origin: "https://boardreadyops.oaslananka.dev",
      readyPath: "/api/health/ready",
      durationMinutes: 5,
      intervalSeconds: 60,
      requestTimeoutMs: 10_000,
      maxConsecutiveFailures: 3,
      reportPath: undefined,
      thresholds: { latencyP95Ms: 2_000, minimumAvailabilityPercent: 99 },
    };
    let clock = 0;
    const requestedUrls: string[] = [];
    const report = await runProductionSoakMonitor(options, {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      request: async (url) => {
        requestedUrls.push(String(url));
        clock += 20;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(requestedUrls).toEqual(Array(5).fill("https://boardreadyops.oaslananka.dev/api/health/ready"));
    expect(report.samplesTaken).toBe(5);
    expect(report.terminatedEarly).toBe(false);
    expect(report.availability).toEqual({ successCount: 5, samplesTaken: 5, availabilityPercent: 100 });
    expect(report.ready.count).toBe(5);
    expect(report.elapsedMinutes).toBeGreaterThanOrEqual(options.durationMinutes);
    expect(evaluateProductionSoakReport(report, options.thresholds)).toEqual([]);
  });

  it("terminates early once consecutive failures exceed the configured maximum", async () => {
    const options = {
      origin: "https://boardreadyops.oaslananka.dev",
      readyPath: "/api/health/ready",
      durationMinutes: 60,
      intervalSeconds: 60,
      requestTimeoutMs: 10_000,
      maxConsecutiveFailures: 2,
      reportPath: undefined,
      thresholds: { latencyP95Ms: 2_000, minimumAvailabilityPercent: 99 },
    };
    let clock = 0;
    const report = await runProductionSoakMonitor(options, {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      request: async () => {
        clock += 5;
        return new Response(JSON.stringify({ ok: false }), { status: 503 });
      },
    });

    expect(report.terminatedEarly).toBe(true);
    expect(report.terminationReason).toBe("max_consecutive_failures_exceeded");
    expect(report.samplesTaken).toBe(2);
  });

  it("counts a thrown request failure as an unavailable sample without a latency measurement", async () => {
    const options = {
      origin: "https://boardreadyops.oaslananka.dev",
      readyPath: "/api/health/ready",
      durationMinutes: 5,
      intervalSeconds: 60,
      requestTimeoutMs: 10_000,
      maxConsecutiveFailures: 5,
      reportPath: undefined,
      thresholds: { latencyP95Ms: 2_000, minimumAvailabilityPercent: 99 },
    };
    let clock = 0;
    let call = 0;
    const report = await runProductionSoakMonitor(options, {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      request: async () => {
        call += 1;
        clock += 5;
        if (call === 2) throw new Error("network unreachable");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(report.samplesTaken).toBe(5);
    expect(report.ready.count).toBe(4);
    expect(report.availability).toEqual({ successCount: 4, samplesTaken: 5, availabilityPercent: 80 });
  });
});

describe("ProductionSoakError", () => {
  it("carries a stable reason and structured details", () => {
    const error = new ProductionSoakError("soak_configuration_invalid", "boom", { field: "origin" });
    expect(error.name).toBe("ProductionSoakError");
    expect(error.reason).toBe("soak_configuration_invalid");
    expect(error.details).toEqual({ field: "origin" });
  });
});
