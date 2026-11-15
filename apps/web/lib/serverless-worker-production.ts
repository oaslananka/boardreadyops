import { randomUUID } from "node:crypto";
import { createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createSqlControlPlaneOperationsStore } from "@boardreadyops/db/control-plane-operations-store";
import { createSqlControlPlaneOutboxStore } from "@boardreadyops/db/control-plane-outbox-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlTransactionalGitHubAppLifecycleStore } from "@boardreadyops/db/transactional-lifecycle-store";
import { createAppAuth } from "@octokit/auth-app";
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
 * Authenticated, read-only acceptance for the isolated serverless runtime.
 * Verifies actual PostgreSQL connectivity, worker prerequisites and GitHub
 * App credentials. Never claims jobs, dispatches Actions or mutates Check Runs.
 */
export async function verifyProductionBoundedWorkerReadiness(): Promise<{
  database: "pass";
  githubApp: "pass";
  runner: "pass";
}> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const runner = runnerModeSummary();
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const checks = createGitHubAppCheckRunClient();
  const dispatch = runnerWorkflowDispatchClient(runner, createRunnerClient);
  if (
    !databaseUrl ||
    !runner.configurationValid ||
    runner.mode !== "github-actions" ||
    !appId ||
    !privateKey ||
    !checks?.readCheckRun ||
    !checks.completeCheckRun ||
    !dispatch
  ) {
    throw new Error("bounded worker prerequisites unavailable");
  }

  const database = createPgQueryExecutor({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await database.withTransaction(
      async (tx) =>
        await tx.query(
          `select
             to_regclass('public.control_plane_jobs') is not null as jobs_ready,
             to_regclass('public.control_plane_outbox') is not null as outbox_ready,
             exists(
               select 1 from cloud_schema_migrations where version = $1
             ) as migration_ready`,
          ["0130_completed_safe_mode_check_run_reconciliation"],
        ),
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
    const rows =
      typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows)
        ? result.rows
        : [];
    const row = rows[0] as { jobs_ready?: boolean; outbox_ready?: boolean; migration_ready?: boolean } | undefined;
    if (row?.jobs_ready !== true || row.outbox_ready !== true || row.migration_ready !== true) {
      throw new Error("bounded worker PostgreSQL schema unavailable");
    }
  } finally {
    await database.close();
  }

  const apiBaseUrl = process.env.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
  const apiUrl = new URL("/app", apiBaseUrl);
  if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error("GitHub API origin unavailable");
  }
  const auth = createAppAuth({ appId, privateKey: privateKey.replaceAll(String.raw`\n`, "\n") });
  const credentials = await auth({ type: "app" });
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${credentials.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("GitHub App identity not accepted");
  const identity = (await response.json()) as { id?: number };
  if (String(identity.id) !== appId) throw new Error("GitHub App identity mismatch");

  return { database: "pass", githubApp: "pass", runner: "pass" };
}

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
