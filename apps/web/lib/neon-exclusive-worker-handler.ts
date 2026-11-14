import { acquireExclusiveWorkerOwnership } from "@boardreadyops/db/worker-ownership";
import { runOneWorkerPass, type WorkerSinglePassOperations } from "./control-plane-worker-runtime.js";
import { createNeonScheduledWorkerHandler } from "./neon-scheduled-worker-handler.js";

type OwnershipAcquirer = typeof acquireExclusiveWorkerOwnership;

export type ExclusiveNeonScheduledWorkerOptions = {
  triggerId: string;
  /** A direct PostgreSQL connection, never Neon/PgBouncer's pooled URL. */
  connectionString: string;
  /** Reuse the existing worker's durable, tenant-scoped queue operations. */
  createOperations(signal: AbortSignal): WorkerSinglePassOperations;
  /** Test seam; production uses the canonical PostgreSQL advisory lock. */
  acquireOwnership?: OwnershipAcquirer;
};

function requireDirectPostgresConnection(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("A direct PostgreSQL connection is required");
  }
  if (
    (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") ||
    !parsed.hostname ||
    parsed.hostname.toLowerCase().includes("-pooler")
  ) {
    throw new Error("A direct PostgreSQL connection is required");
  }
}

function guardOperation(signal: AbortSignal, operation: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (signal.aborted) throw new Error("worker_ownership_lost");
    await operation();
    if (signal.aborted) throw new Error("worker_ownership_lost");
  };
}

/**
 * Invoke the existing one-batch worker under a dedicated, session-level
 * PostgreSQL advisory lock. The Neon HTTP handler performs trigger admission
 * first; the database lock serializes requests ACROSS Neon Function isolates.
 *
 * This is an integration primitive, not the actual production queue adapter.
 * The supplied operations must use the existing durable idempotent claims and
 * honor AbortSignal when a currently-running external effect can be cancelled.
 */
export function createExclusiveNeonScheduledWorkerHandler(
  options: ExclusiveNeonScheduledWorkerOptions,
): (request: Request) => Promise<Response> {
  requireDirectPostgresConnection(options.connectionString);
  const acquire = options.acquireOwnership ?? acquireExclusiveWorkerOwnership;
  return createNeonScheduledWorkerHandler({
    triggerId: options.triggerId,
    runOnce: async () => {
      const abort = new AbortController();
      const ownership = await acquire({
        connectionString: options.connectionString,
        onLost: () => {
          abort.abort(new Error("worker_ownership_lost"));
        },
      });
      try {
        if (abort.signal.aborted) throw new Error("worker_ownership_lost");
        const operations = options.createOperations(abort.signal);
        await runOneWorkerPass({
          lifecycle: guardOperation(abort.signal, operations.lifecycle),
          outbox: guardOperation(abort.signal, operations.outbox),
          artifactDeletion: guardOperation(abort.signal, operations.artifactDeletion),
          stripe: guardOperation(abort.signal, operations.stripe),
          lifecycleReconciliation: guardOperation(abort.signal, operations.lifecycleReconciliation),
          githubReconciliation: guardOperation(abort.signal, operations.githubReconciliation),
          maintenance: guardOperation(abort.signal, operations.maintenance),
        });
        if (abort.signal.aborted) throw new Error("worker_ownership_lost");
      } finally {
        // Do not relinquish exclusivity until the final in-flight task settles.
        await ownership.release();
      }
    },
  });
}
