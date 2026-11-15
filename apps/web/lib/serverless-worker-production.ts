import { randomUUID } from "node:crypto";
import { createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createSqlControlPlaneOperationsStore } from "@boardreadyops/db/control-plane-operations-store";
import { createSqlControlPlaneOutboxStore } from "@boardreadyops/db/control-plane-outbox-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlTransactionalGitHubAppLifecycleStore } from "@boardreadyops/db/transactional-lifecycle-store";
import { processControlPlaneCheckRunReconciliation } from "./control-plane-check-run-reconciliation-worker.js";
import { processControlPlaneLifecycleReconciliation } from "./control-plane-lifecycle-reconciliation-worker.js";
import { processControlPlaneOutboxEffect } from "./control-plane-outbox-worker.js";
import { processControlPlaneWorkflowReconciliation } from "./control-plane-reconciliation-worker.js";
import { processControlPlaneJob } from "./control-plane-worker.js";
import { createGitHubAppCheckRunClient } from "./github-app-check-run-client.js";
import { createProductionGitHubCommandLifecycleExecutor } from "./github-command-executor.js";
import { createGitHubWorkflowReconciliationClient } from "./github-workflow-reconciliation-client.js";
import { createProductionRepositorySetupLifecycleExecutor } from "./repository-setup-automation.js";
import { createRunnerClient } from "./runner-client.js";
import { runnerModeSummary, runnerWorkflowDispatchClient } from "./runner-mode.js";
import {
  type BoundedPassCounts,
  detectBoundedReconciliationCandidates,
  drainBoundedQueues,
} from "./serverless-worker-pass.js";

/**
 * Safe for short-lived serverless invocations. The same SQL leases and
 * transactionally planned outbox effects are used by the existing VPS worker.
 * This never starts a persistent loop or an extra HTTP listener.
 */
export async function runProductionBoundedPass(): Promise<BoundedPassCounts> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const runner = runnerModeSummary();
  if (!databaseUrl || !runner.configurationValid || runner.mode !== "github-actions") {
    throw new Error("bounded worker requires configured PostgreSQL and the GitHub Actions runner");
  }
  const checkRuns = createGitHubAppCheckRunClient();
  const workflowClient = createGitHubWorkflowReconciliationClient();
  const dispatchClient = runnerWorkflowDispatchClient(runner, createRunnerClient);
  if (
    !checkRuns?.ensurePullRequestCheckRun ||
    !checkRuns.completeCheckRun ||
    !checkRuns.readCheckRun ||
    !dispatchClient
  ) {
    throw new Error("bounded worker cannot dispatch without all GitHub App capabilities");
  }

  const durableCheckRuns = {
    ensurePullRequestCheckRun: checkRuns.ensurePullRequestCheckRun,
    completeCheckRun: checkRuns.completeCheckRun,
  };
  const reconciliationCheckRuns = {
    readCheckRun: checkRuns.readCheckRun,
    completeCheckRun: checkRuns.completeCheckRun,
  };
  const workerId = `serverless-${randomUUID()}`;
  const db = createPgQueryExecutor({ connectionString: databaseUrl, max: 2 });
  try {
    const jobs = createSqlControlPlaneJobStore(db);
    const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(db);
    const outbox = createSqlControlPlaneOutboxStore(db);
    const operations = createSqlControlPlaneOperationsStore(db);

    // The original worker repeats this detection on a timer. In a short
    // serverless invocation it must run against durable SQL state instead.
    await detectBoundedReconciliationCandidates(operations);

    const setup = createProductionRepositorySetupLifecycleExecutor(db);
    const command = createProductionGitHubCommandLifecycleExecutor();
    const interactions = {
      ...(setup
        ? {
            createSetupPr: setup.createSetupPr,
            probeSetup: setup.probeSetup,
            createWaiverPr: setup.createWaiverPr,
            prepareRelease: setup.prepareRelease,
          }
        : {}),
      ...(command ? { executeGitHubCommand: command.executeGitHubCommand } : {}),
    };

    // Operations are sequential per lane. The SQL claim leases protect even
    // simultaneous invocations (webhook wakeup + scheduled recovery).
    return await drainBoundedQueues({
      jobs: {
        claim: (limit) => jobs.claimJobs({ workerId, limit }),
        process: (job) => processControlPlaneJob(job, { workerId, jobs, lifecycle, interactions }),
      },
      outbox: {
        claim: (limit) => outbox.claimEffects({ workerId, limit }),
        process: (effect) =>
          processControlPlaneOutboxEffect(effect, {
            workerId,
            outbox,
            dispatchMode: "github-actions",
            checkRuns: durableCheckRuns,
            workflowDispatch: dispatchClient,
          }),
      },
      lifecycle: {
        claim: (limit) => operations.claimLifecycleReconciliationItems({ workerId, limit }),
        process: (item) => processControlPlaneLifecycleReconciliation(item, { workerId, operations }),
      },
      workflow: {
        claim: (limit) => operations.claimWorkflowReconciliationItems({ workerId, limit }),
        process: (item) =>
          processControlPlaneWorkflowReconciliation(item, {
            workerId,
            operations,
            github: workflowClient,
            nextCheckSeconds: 60,
          }),
      },
      checkRun: {
        claim: (limit) => operations.claimCheckRunReconciliationItems({ workerId, limit }),
        process: (item) =>
          processControlPlaneCheckRunReconciliation(item, {
            workerId,
            operations,
            github: reconciliationCheckRuns,
            nextCheckSeconds: 60,
          }),
      },
    });
  } finally {
    await db.close();
  }
}
