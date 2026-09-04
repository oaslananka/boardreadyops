export const CONTROL_PLANE_RUN_LISTING_BENCHMARK_CONFIRMATION: "isolated-disposable-database";

export type RunListingBenchmarkThresholds = {
  p95Ms: number;
  depthDegradationRatioMax: number;
};

export type RunListingBenchmarkConfiguration = {
  databaseUrl: string;
  smallDatasetRuns: number;
  largeDatasetRuns: number;
  pageSizes: number[];
  pageDepth: number;
  thresholds: RunListingBenchmarkThresholds;
};

export type RunListingBenchmarkTier = {
  dataset: "small" | "large";
  pageSize: number;
  pagesWalked: number;
  count: number;
  elapsedMs: number;
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumMs: number;
  firstQuarterP95Ms: number;
  lastQuarterP95Ms: number;
  depthDegradationRatio: number;
};

export type RunListingBenchmarkReport = {
  event: "control_plane_run_listing_pagination_benchmark_verified";
  scenario: {
    smallDatasetRuns: number;
    largeDatasetRuns: number;
    pageSizes: number[];
    pageDepth: number;
  };
  paginationStyle: "cursor";
  tiers: RunListingBenchmarkTier[];
  signals: string[];
};

export type RunListingBenchmarkDependencies = {
  createPgQueryExecutor: typeof import("../packages/db/src/pg-executor.js").createPgQueryExecutor;
  loadViewerRuns: typeof import("../apps/web/lib/run-listing.js").loadViewerRuns;
  decodeRunListingCursor: typeof import("../apps/web/lib/run-listing.js").decodeRunListingCursor;
  runListingSource: string;
};
export function parseRunListingBenchmarkConfiguration(
  environment?: Readonly<Record<string, string | undefined>>,
): RunListingBenchmarkConfiguration;

export function assertKeysetPagination(runListingSource: string): "cursor";

export function evaluateRunListingBenchmarkReport(
  report: {
    tiers: Array<{
      dataset: string;
      pageSize: number;
      p95Ms: number;
      depthDegradationRatio: number;
    }>;
  },
  thresholds: RunListingBenchmarkThresholds,
): string[];

export function runRunListingPaginationBenchmark(
  configuration: RunListingBenchmarkConfiguration,
  dependencies: RunListingBenchmarkDependencies,
): Promise<RunListingBenchmarkReport>;
