import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertKeysetPagination,
  CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION,
  evaluateRunListingBenchmarkReport,
  parseRunListingBenchmarkConfiguration,
} from "../../../scripts/control-plane-run-listing-benchmark.mjs";

const databaseUrl = "postgresql://load_user:load-secret@127.0.0.1:5432/boardreadyops_load";

function configuredEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: databaseUrl,
    BOARDREADYOPS_LOAD_CONFIRMATION: CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION,
    ...overrides,
  };
}

describe("run-listing pagination benchmark configuration", () => {
  it("uses a bounded default scenario", () => {
    expect(parseRunListingBenchmarkConfiguration(configuredEnvironment())).toEqual({
      databaseUrl,
      smallDatasetRuns: 200,
      largeDatasetRuns: 20_000,
      pageSizes: [10, 25, 100],
      pageDepth: 20,
      thresholds: {
        p95Ms: 500,
        depthDegradationRatioMax: 3,
      },
    });
  });

  it("accepts explicit bounded overrides", () => {
    expect(
      parseRunListingBenchmarkConfiguration(
        configuredEnvironment({
          BOARDREADYOPS_RUN_LISTING_SMALL_DATASET: "100",
          BOARDREADYOPS_RUN_LISTING_LARGE_DATASET: "5000",
          BOARDREADYOPS_RUN_LISTING_PAGE_SIZES: "5, 50",
          BOARDREADYOPS_RUN_LISTING_PAGE_DEPTH: "10",
          BOARDREADYOPS_RUN_LISTING_P95_MS: "250",
          BOARDREADYOPS_RUN_LISTING_DEPTH_DEGRADATION_RATIO_MAX: "2",
        }),
      ),
    ).toEqual({
      databaseUrl,
      smallDatasetRuns: 100,
      largeDatasetRuns: 5_000,
      pageSizes: [5, 50],
      pageDepth: 10,
      thresholds: {
        p95Ms: 250,
        depthDegradationRatioMax: 2,
      },
    });
  });

  it("requires a disposable database confirmation and DATABASE_URL", () => {
    expect(() =>
      parseRunListingBenchmarkConfiguration({ DATABASE_URL: databaseUrl, BOARDREADYOPS_LOAD_CONFIRMATION: "yes" }),
    ).toThrow("isolated load-test confirmation is required");

    expect(() =>
      parseRunListingBenchmarkConfiguration({
        BOARDREADYOPS_LOAD_CONFIRMATION: CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION,
      }),
    ).toThrow("DATABASE_URL is required for the run-listing pagination benchmark");
  });

  it("rejects malformed or out-of-range page sizes", () => {
    expect(() =>
      parseRunListingBenchmarkConfiguration(configuredEnvironment({ BOARDREADYOPS_RUN_LISTING_PAGE_SIZES: "10,abc" })),
    ).toThrow("BOARDREADYOPS_RUN_LISTING_PAGE_SIZES must be a comma-separated list of positive integers");

    expect(() =>
      parseRunListingBenchmarkConfiguration(configuredEnvironment({ BOARDREADYOPS_RUN_LISTING_PAGE_SIZES: "500" })),
    ).toThrow("BOARDREADYOPS_RUN_LISTING_PAGE_SIZES entries must be between 1 and 200");
  });
});

describe("keyset pagination assertion", () => {
  const keysetSource = `
    and ($2::timestamptz is null or (release_runs.started_at, release_runs.id) < ($2::timestamptz, $3::text))
   order by release_runs.started_at desc, release_runs.id desc
   limit $4\`;
  `;

  it("accepts the real keyset predicate shape", () => {
    expect(assertKeysetPagination(keysetSource)).toBe("cursor");
  });

  it("rejects a query that mentions OFFSET", () => {
    expect(() => assertKeysetPagination(`${keysetSource}\n offset $5`)).toThrow(
      "run listing query appears to use OFFSET pagination; benchmark assumptions no longer hold",
    );
  });

  it("rejects a query missing the expected keyset predicate", () => {
    expect(() => assertKeysetPagination("select * from release_runs limit $1")).toThrow(
      "run listing query no longer matches the expected keyset predicate shape",
    );
  });
});

describe("run-listing benchmark report evaluation", () => {
  const thresholds = { p95Ms: 500, depthDegradationRatioMax: 3 };

  it("passes a report with flat page latency across depth", () => {
    const report = {
      tiers: [
        { dataset: "small", pageSize: 25, p95Ms: 40, depthDegradationRatio: 1.1 },
        { dataset: "large", pageSize: 25, p95Ms: 55, depthDegradationRatio: 1.4 },
      ],
    };
    expect(evaluateRunListingBenchmarkReport(report, thresholds)).toEqual([]);
  });

  it("flags a p95 breach and offset-shaped depth degradation with stable signal names", () => {
    const report = {
      tiers: [
        { dataset: "small", pageSize: 25, p95Ms: 40, depthDegradationRatio: 1.1 },
        { dataset: "large", pageSize: 100, p95Ms: 900, depthDegradationRatio: 6.2 },
      ],
    };
    expect(evaluateRunListingBenchmarkReport(report, thresholds)).toEqual([
      "large_page100_p95_exceeded",
      "large_page100_depth_degradation_exceeded",
    ]);
  });
});

describe("run-listing benchmark repository hygiene", () => {
  it("keeps generated local benchmark evidence out of the tracked checkout", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toContain("/control-plane-run-listing-benchmark-report.json");
  });

  it("keeps the benchmark workflow manual, read-only, and pinned", () => {
    const workflow = readFileSync(".github/workflows/control-plane-run-listing-benchmark.yml", "utf8");
    const triggerBlock = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));
    expect(triggerBlock).toContain("workflow_dispatch:");
    expect(triggerBlock).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0");
    expect(workflow).toContain("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).toContain("image: postgres:16-alpine");
    expect(workflow).toContain("BOARDREADYOPS_LOAD_CONFIRMATION: isolated-disposable-database");
    expect(workflow).toContain("pnpm --filter @boardreadyops/db db:migrate");
    expect(workflow).toContain("pnpm run cloud:run-listing-benchmark:verify");
  });
});
