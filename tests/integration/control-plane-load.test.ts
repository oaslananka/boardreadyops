import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { processControlPlaneWorkflowReconciliation } from "../../apps/web/lib/control-plane-reconciliation-worker.js";
import { lookupRunDashboard } from "../../apps/web/lib/run-dashboard.js";
import { createSqlControlPlaneJobStore } from "../../packages/db/src/control-plane-job-store.js";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createSqlControlPlaneOutboxStore } from "../../packages/db/src/control-plane-outbox-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerLeaseStore } from "../../packages/db/src/runner-lease-store.js";
import { createSqlRunnerTerminalResultAuthorizer } from "../../packages/db/src/runner-terminal-result-store.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../packages/db/src/transactional-lifecycle-store.js";
import {
  parseControlPlaneLoadConfiguration,
  runControlPlaneLoadValidation,
} from "../../scripts/control-plane-load.mjs";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

type InterruptionClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows?: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
};

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => InterruptionClient;
};

const connectionString = getPostgresTestConnectionString();
const loadValidationEnabled = process.env.BOARDREADYOPS_CONTROL_PLANE_LOAD_TESTS === "true";
const describeLoad = connectionString && loadValidationEnabled ? describe : describe.skip;

describeLoad("control-plane PostgreSQL load validation", () => {
  it("keeps the selected load profile within thresholds and tenant boundaries", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const configuration = parseControlPlaneLoadConfiguration({
      ...process.env,
      DATABASE_URL: connectionString,
    });
    const report = await runControlPlaneLoadValidation(configuration, {
      createPostgresClient: (options) => new Client(options),
      createPgQueryExecutor,
      createSqlControlPlaneJobStore,
      createSqlControlPlaneOutboxStore,
      createSqlControlPlaneOperationsStore,
      createSqlRunnerLeaseStore,
      createSqlRunnerTerminalResultAuthorizer,
      createSqlTransactionalGitHubAppLifecycleStore,
      processControlPlaneWorkflowReconciliation,
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
    if (configuration.profile !== "representative") {
      expect(report.recovery).toEqual(
        expect.objectContaining({
          roundsRequested: configuration.recoveryRounds,
          roundsCompleted: configuration.recoveryRounds,
          jobLeaseRecoveries: configuration.recoveryRounds,
          staleJobCompletionsRejected: configuration.recoveryRounds,
          outboxRetries: configuration.recoveryRounds,
          uncertainOutboxQuarantines: configuration.recoveryRounds,
          delayedCallbackRepairs: configuration.recoveryRounds,
          staleAttemptResultsRejected: configuration.recoveryRounds,
          deadLetters: 0,
          ambiguousNonterminalStates: 0,
        }),
      );
      expect(report.recovery?.maximumConvergenceMs).toBeGreaterThanOrEqual(0);
    } else {
      expect(report.recovery).toBeUndefined();
    }
    if (configuration.profile === "worker-process-interruption") {
      expect(report.workerProcessRecovery).toEqual(
        expect.objectContaining({
          roundsRequested: configuration.recoveryRounds,
          roundsCompleted: configuration.recoveryRounds,
          childProcessesStarted: configuration.recoveryRounds,
          childProcessesKilled: configuration.recoveryRounds,
          abandonedLeasesReclaimed: configuration.recoveryRounds,
          replacementCompletions: configuration.recoveryRounds,
        }),
      );
      expect(report.workerProcessRecovery?.maximumConvergenceMs).toBeGreaterThanOrEqual(0);
    } else {
      expect(report.workerProcessRecovery).toBeUndefined();
    }
    if (configuration.profile === "database-interruption") {
      expect(report.databaseRecovery).toEqual(
        expect.objectContaining({
          roundsRequested: configuration.recoveryRounds,
          roundsCompleted: configuration.recoveryRounds,
          backendTerminations: configuration.recoveryRounds,
          interruptedTransactionsRejected: configuration.recoveryRounds,
          transactionRollbacksVerified: configuration.recoveryRounds,
          replacementConnectionsEstablished: configuration.recoveryRounds,
        }),
      );
      expect(report.databaseRecovery?.maximumConvergenceMs).toBeGreaterThanOrEqual(0);
    } else {
      expect(report.databaseRecovery).toBeUndefined();
    }
  }, 120_000);
});
