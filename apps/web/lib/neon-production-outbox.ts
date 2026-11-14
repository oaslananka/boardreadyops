import type {
  ClaimedControlPlaneOutboxEffect,
  ControlPlaneOutboxStore,
} from "@boardreadyops/db/control-plane-outbox-store";
import { createSqlControlPlaneOutboxStore } from "@boardreadyops/db/control-plane-outbox-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { processControlPlaneOutboxEffect } from "./control-plane-outbox-worker.js";
import { configuredGitHubActionsWorkflow } from "./github-actions-workflow.js";
import { createGitHubAppCheckRunClient } from "./github-app-check-run-client.js";
import { createRunnerClient } from "./runner-client.js";
import { runnerModeSummary, runnerWorkflowDispatchClient } from "./runner-mode.js";

type BatchOptions = {
  workerId: string;
  limit: number;
  signal: AbortSignal;
  claimEffects: ControlPlaneOutboxStore["claimEffects"];
  process(effect: ClaimedControlPlaneOutboxEffect): Promise<unknown>;
};

/** Reuse canonical persisted outbox claims; do not invent a parallel external-delivery ledger. */
export async function runClaimedOutboxBatch(options: BatchOptions): Promise<void> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 4) {
    throw new Error("Neon outbox batch limit must be between 1 and 4");
  }
  if (options.signal.aborted) throw new Error("worker_ownership_lost");
  const claimed = await options.claimEffects({ workerId: options.workerId, limit: options.limit });
  for (const effect of claimed) {
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
    await options.process(effect);
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
  }
}

export type ProductionNeonOutboxOptions = {
  workerId: string;
  connectionString: string;
  batchLimit?: number;
  environment?: Readonly<Record<string, string | undefined>>;
};

/**
 * Called ONLY while the already-validated Neon Function owns the exclusive
 * unpooled PostgreSQL advisory session. The SQL work pool is independent of
 * that dedicated owner session, matching apps/web/worker.ts.
 *
 * External GitHub network calls cannot yet be cancelled in flight; preserve
 * the canonical uncertainty quarantine/reconciliation flow on failure.
 */
export function createProductionNeonOutboxOperation(
  options: ProductionNeonOutboxOptions,
): (signal: AbortSignal) => Promise<void> {
  const environment = options.environment ?? process.env;
  const runner = runnerModeSummary(environment);
  if (!runner.configurationValid || runner.mode !== "github-actions") {
    throw new Error("Neon outbox requires github-actions runner mode");
  }
  if (!environment.GITHUB_APP_ID?.trim() || !environment.GITHUB_APP_PRIVATE_KEY?.trim()) {
    throw new Error("GitHub App credentials are required for Neon outbox");
  }
  const publicOrigin = environment.BOARDREADYOPS_PUBLIC_URL?.trim() || environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!publicOrigin) throw new Error("A public URL is required for GitHub Actions result callbacks");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(publicOrigin);
  } catch {
    throw new Error("A valid HTTPS public URL is required");
  }
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) {
    throw new Error("An HTTPS public URL is required for GitHub Actions result callbacks");
  }
  if (!configuredGitHubActionsWorkflow(environment)) {
    throw new Error("A valid GitHub Actions workflow filename is required");
  }
  const limit = options.batchLimit ?? 2;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4) {
    throw new Error("Neon outbox batch limit must be between 1 and 4");
  }
  if (!options.connectionString.trim()) throw new Error("Outbox PostgreSQL URL is required");

  return async (signal) => {
    if (signal.aborted) throw new Error("worker_ownership_lost");
    // The client constructors intentionally reuse production GitHub App
    // authentication and workflow configuration; no second mutation adapter.
    const checkRuns = createGitHubAppCheckRunClient();
    const workflowDispatch = runnerWorkflowDispatchClient(runner, createRunnerClient);
    const ensurePullRequestCheckRun = checkRuns?.ensurePullRequestCheckRun;
    if (!checkRuns || !ensurePullRequestCheckRun || !workflowDispatch) {
      throw new Error("GitHub Actions outbox clients are unavailable");
    }
    const executor = createPgQueryExecutor({ connectionString: options.connectionString, max: 2 });
    try {
      const outbox = createSqlControlPlaneOutboxStore(executor);
      await runClaimedOutboxBatch({
        workerId: options.workerId,
        limit,
        signal,
        claimEffects: (input) => outbox.claimEffects(input),
        process: (effect) =>
          processControlPlaneOutboxEffect(effect, {
            workerId: options.workerId,
            outbox,
            dispatchMode: "github-actions",
            checkRuns: {
              ensurePullRequestCheckRun,
              completeCheckRun: checkRuns.completeCheckRun,
            },
            workflowDispatch,
          }),
      });
    } finally {
      await executor.close();
    }
  };
}
