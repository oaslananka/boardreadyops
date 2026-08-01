import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { lookupRunDashboard } from "../../apps/web/lib/run-dashboard.js";
import { createSqlControlPlaneJobStore } from "../../packages/db/src/control-plane-job-store.js";
import { createSqlControlPlaneOutboxStore } from "../../packages/db/src/control-plane-outbox-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../packages/db/src/transactional-lifecycle-store.js";
import {
  parseControlPlaneLoadConfiguration,
  runControlPlaneLoadValidation,
} from "../../scripts/control-plane-load.mjs";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const loadValidationEnabled = process.env.BOARDREADYOPS_CONTROL_PLANE_LOAD_TESTS === "true";
const describeLoad = connectionString && loadValidationEnabled ? describe : describe.skip;

describeLoad("control-plane PostgreSQL load validation", () => {
  it("keeps representative concurrent work within thresholds and tenant boundaries", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const configuration = parseControlPlaneLoadConfiguration({
      ...process.env,
      DATABASE_URL: connectionString,
    });
    const report = await runControlPlaneLoadValidation(configuration, {
      createPgQueryExecutor,
      createSqlControlPlaneJobStore,
      createSqlControlPlaneOutboxStore,
      createSqlTransactionalGitHubAppLifecycleStore,
      lookupRunDashboard,
    });
    const expectedRuns = configuration.repositoryCount * configuration.runsPerRepository;

    process.stdout.write(`${JSON.stringify(report)}\n`);
    const reportPath = process.env.BOARDREADYOPS_LOAD_REPORT_PATH?.trim();
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });

    expect(report.signals).toEqual([]);
    expect(report.invariants).toEqual({
      acceptedDeliveries: configuration.uniqueDeliveries,
      duplicateDeliveries: configuration.duplicateDeliveries,
      completedJobs: configuration.uniqueDeliveries,
      releaseRuns: expectedRuns,
      completedOutboxEffects: expectedRuns,
      scopedDashboardReads: configuration.repositoryCount * 2,
      crossTenantMismatches: 0,
    });
  }, 120_000);
});
