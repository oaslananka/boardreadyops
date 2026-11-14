import {
  type ControlPlaneOperationsStore,
  createSqlControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { processControlPlaneCheckRunReconciliation } from "./control-plane-check-run-reconciliation-worker.js";
import { processControlPlaneWorkflowReconciliation } from "./control-plane-reconciliation-worker.js";
import { createGitHubAppCheckRunClient } from "./github-app-check-run-client.js";
import {
  createGitHubWorkflowReconciliationClient,
  type GitHubWorkflowReconciliationClient,
} from "./github-workflow-reconciliation-client.js";
import { runnerModeSummary } from "./runner-mode.js";

type CheckRunReconciliationClient = {
  readCheckRun: NonNullable<NonNullable<ReturnType<typeof createGitHubAppCheckRunClient>>["readCheckRun"]>;
  completeCheckRun: NonNullable<ReturnType<typeof createGitHubAppCheckRunClient>>["completeCheckRun"];
};

type PassOptions = {
  workerId: string;
  limit: number;
  signal: AbortSignal;
  operations: ControlPlaneOperationsStore;
  workflowGitHub: GitHubWorkflowReconciliationClient;
  checkRunGitHub: CheckRunReconciliationClient;
};

/**
 * Existing persisted SQL detection/claim/guarded terminal transitions, never
 * an HTTP-supplied tenant or run ID. Caller already holds the global PG lock.
 */
export async function runClaimedGitHubReconciliationPass(options: PassOptions): Promise<void> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 4) {
    throw new Error("Neon reconciliation batch limit must be between 1 and 4");
  }
  const checkOwner = () => {
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
  };
  checkOwner();
  await options.operations.detectWorkflowReconciliationCandidates({
    observationDelaySeconds: 300,
    terminalDeadlineSeconds: 1800,
    limit: options.limit,
  });
  checkOwner();
  await options.operations.detectCheckRunReconciliationCandidates({
    observationDelaySeconds: 300,
    terminalDeadlineSeconds: 1800,
    limit: options.limit,
  });
  checkOwner();
  const workflowItems = await options.operations.claimWorkflowReconciliationItems({
    workerId: options.workerId,
    limit: options.limit,
  });
  for (const item of workflowItems) {
    checkOwner();
    await processControlPlaneWorkflowReconciliation(item, {
      workerId: options.workerId,
      operations: options.operations,
      github: options.workflowGitHub,
      nextCheckSeconds: 60,
    });
    checkOwner();
  }
  const checkRunItems = await options.operations.claimCheckRunReconciliationItems({
    workerId: options.workerId,
    limit: options.limit,
  });
  for (const item of checkRunItems) {
    checkOwner();
    await processControlPlaneCheckRunReconciliation(item, {
      workerId: options.workerId,
      operations: options.operations,
      github: options.checkRunGitHub,
      nextCheckSeconds: 60,
    });
    checkOwner();
  }
}

export type ProductionNeonReconciliationOptions = {
  workerId: string;
  connectionString: string;
  batchLimit?: number;
  environment?: Readonly<Record<string, string | undefined>>;
};

/** Explicit opt-in, same advisory lock as lifecycle/outbox; no new GitHub API adapter. */
export function createProductionNeonReconciliationOperation(
  options: ProductionNeonReconciliationOptions,
): (signal: AbortSignal) => Promise<void> {
  const environment = options.environment ?? process.env;
  const runner = runnerModeSummary(environment);
  if (!runner.configurationValid || runner.mode !== "github-actions") {
    throw new Error("Neon reconciliation requires github-actions runner mode");
  }
  if (!environment.GITHUB_APP_ID?.trim() || !environment.GITHUB_APP_PRIVATE_KEY?.trim()) {
    throw new Error("GitHub App credentials are required for Neon reconciliation");
  }
  const limit = options.batchLimit ?? 2;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4) {
    throw new Error("Neon reconciliation batch limit must be between 1 and 4");
  }
  if (!options.connectionString.trim()) throw new Error("Reconciliation PostgreSQL URL is required");

  return async (signal) => {
    if (signal.aborted) throw new Error("worker_ownership_lost");
    const workflowGitHub = createGitHubWorkflowReconciliationClient();
    const checkRunClient = createGitHubAppCheckRunClient();
    const readCheckRun = checkRunClient?.readCheckRun;
    if (!workflowGitHub || !checkRunClient || !readCheckRun) {
      throw new Error("GitHub reconciliation clients are unavailable");
    }
    const executor = createPgQueryExecutor({ connectionString: options.connectionString, max: 2 });
    try {
      await runClaimedGitHubReconciliationPass({
        workerId: options.workerId,
        limit,
        signal,
        operations: createSqlControlPlaneOperationsStore(executor),
        workflowGitHub,
        checkRunGitHub: { readCheckRun, completeCheckRun: checkRunClient.completeCheckRun },
      });
    } finally {
      await executor.close();
    }
  };
}
