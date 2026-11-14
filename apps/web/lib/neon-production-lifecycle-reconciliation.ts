import {
  type ControlPlaneOperationsStore,
  createSqlControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { processControlPlaneLifecycleReconciliation } from "./control-plane-lifecycle-reconciliation-worker.js";

type ReconciliationOperations = Pick<
  ControlPlaneOperationsStore,
  | "detectLifecycleReconciliationCandidates"
  | "claimLifecycleReconciliationItems"
  | "applyLifecycleReconciliation"
  | "failReconciliationItem"
>;

type PassOptions = {
  workerId: string;
  limit: number;
  signal: AbortSignal;
  operations: ReconciliationOperations;
};

/** Reuse the canonical durable SQL reconciliation state machine under an exclusive owner session. */
export async function runClaimedLifecycleReconciliationPass(options: PassOptions): Promise<void> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 4) {
    throw new Error("Neon lifecycle reconciliation batch limit must be between 1 and 4");
  }
  const checkOwner = () => {
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
  };
  checkOwner();
  await options.operations.detectLifecycleReconciliationCandidates({
    observationDelaySeconds: 300,
    terminalDeadlineSeconds: 1800,
    limit: options.limit * 5,
  });
  checkOwner();
  const items = await options.operations.claimLifecycleReconciliationItems({
    workerId: options.workerId,
    limit: options.limit,
  });
  for (const item of items) {
    checkOwner();
    await processControlPlaneLifecycleReconciliation(item, {
      workerId: options.workerId,
      operations: options.operations,
    });
    checkOwner();
  }
}

export type ProductionNeonLifecycleReconciliationOptions = {
  workerId: string;
  connectionString: string;
  batchLimit?: number;
};

/**
 * Opt-in PostgreSQL-only repair pass. The caller owns the existing
 * single-worker advisory lock and is already authenticated by Neon schedule.
 * No additional queue, worker process, GitHub credential, or direct HTTP route.
 */
export function createProductionNeonLifecycleReconciliationOperation(
  options: ProductionNeonLifecycleReconciliationOptions,
): (signal: AbortSignal) => Promise<void> {
  const limit = options.batchLimit ?? 2;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4) {
    throw new Error("Neon lifecycle reconciliation batch limit must be between 1 and 4");
  }
  if (!options.workerId || options.workerId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(options.workerId)) {
    throw new Error("A bounded worker ID is required");
  }
  if (!options.connectionString.trim()) {
    throw new Error("A reconciliation PostgreSQL URL is required");
  }
  return async (signal) => {
    if (signal.aborted) throw new Error("worker_ownership_lost");
    const executor = createPgQueryExecutor({ connectionString: options.connectionString, max: 2 });
    try {
      const operations = createSqlControlPlaneOperationsStore(executor);
      await runClaimedLifecycleReconciliationPass({
        workerId: options.workerId,
        limit,
        signal,
        operations,
      });
    } finally {
      await executor.close();
    }
  };
}
