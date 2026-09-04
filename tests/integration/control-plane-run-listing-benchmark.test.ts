import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeRunListingCursor, loadViewerRuns } from "../../apps/web/lib/run-listing.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import {
  parseRunListingBenchmarkConfiguration,
  runRunListingPaginationBenchmark,
} from "../../scripts/control-plane-run-listing-benchmark.mjs";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const benchmarkEnabled = process.env.BOARDREADYOPS_RUN_LISTING_BENCHMARK_TESTS === "true";
const describeBenchmark = connectionString && benchmarkEnabled ? describe : describe.skip;

describeBenchmark("control-plane run-listing pagination benchmark", () => {
  it("keeps cursor-paginated page latency and depth degradation within bounds", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const configuration = parseRunListingBenchmarkConfiguration({
      ...process.env,
      DATABASE_URL: connectionString,
    });
    const runListingSource = await readFile(resolve("apps/web/lib/run-listing.ts"), "utf8");

    const report = await runRunListingPaginationBenchmark(configuration, {
      createPgQueryExecutor,
      loadViewerRuns,
      decodeRunListingCursor,
      runListingSource,
    });

    process.stdout.write(`${JSON.stringify(report)}\n`);
    const reportPath = process.env.BOARDREADYOPS_RUN_LISTING_REPORT_PATH?.trim();
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });

    expect(report.paginationStyle).toBe("cursor");
    expect(report.signals).toEqual([]);
    expect(report.tiers).toHaveLength(2 * configuration.pageSizes.length);
    for (const tier of report.tiers) {
      expect(tier.pagesWalked).toBeGreaterThan(0);
      expect(tier.count).toBe(tier.pagesWalked);
    }
  });
});
