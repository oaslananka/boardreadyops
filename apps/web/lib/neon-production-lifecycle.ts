import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlTransactionalGitHubAppLifecycleStore } from "@boardreadyops/db/transactional-lifecycle-store";
import type { ControlPlaneWorkerDependencies } from "./control-plane-worker.js";
import { processControlPlaneJob } from "./control-plane-worker.js";
import { createProductionGitHubCommandLifecycleExecutor } from "./github-command-executor.js";
import { createExclusiveNeonScheduledWorkerHandler } from "./neon-exclusive-worker-handler.js";
import { createProductionNeonOutboxOperation } from "./neon-production-outbox.js";
import { createProductionNeonReconciliationOperation } from "./neon-production-reconciliation.js";
import { createProductionRepositorySetupLifecycleExecutor } from "./repository-setup-automation.js";

type BatchOptions = {
  workerId: string;
  limit: number;
  signal: AbortSignal;
  claimJobs: ControlPlaneJobStore["claimJobs"];
  process(job: ClaimedControlPlaneJob): Promise<unknown>;
};

/** Claim only persisted, already-authenticated GitHub events; never use an HTTP body as job scope. */
export async function runClaimedLifecycleBatch(options: BatchOptions): Promise<void> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 4) {
    throw new Error("Neon lifecycle batch limit must be between 1 and 4");
  }
  if (options.signal.aborted) throw new Error("worker_ownership_lost");
  const claimed = await options.claimJobs({ workerId: options.workerId, limit: options.limit });
  for (const job of claimed) {
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
    await options.process(job);
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
  }
}

export type ProductionNeonLifecycleOptions = {
  triggerId: string;
  /** Direct PostgreSQL owner session, e.g. Neon's DATABASE_URL_UNPOOLED. */
  connectionString: string;
  /** Normal pooled PostgreSQL URL for the durable store transactions. */
  workerConnectionString: string;
  workerId: string;
  batchLimit?: number;
  enableOutbox?: boolean;
  enableGitHubReconciliation?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
};

const noop = async (): Promise<void> => undefined;

export function createProductionNeonLifecycleHandler(
  options: ProductionNeonLifecycleOptions,
): (request: Request) => Promise<Response> {
  const environment = options.environment ?? process.env;
  if (!environment.GITHUB_APP_ID?.trim() || !environment.GITHUB_APP_PRIVATE_KEY?.trim()) {
    throw new Error("GitHub App credentials are required for Neon lifecycle processing");
  }
  const limit = options.batchLimit ?? 2;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4) {
    throw new Error("Neon lifecycle batch limit must be between 1 and 4");
  }
  if (!options.workerId || options.workerId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(options.workerId)) {
    throw new Error("A bounded worker ID is required");
  }
  if (!options.workerConnectionString.trim()) throw new Error("A PostgreSQL work queue URL is required");

  // The outbox is an independent opt-in. Validate its configuration before
  // accepting a schedule or opening the exclusive PostgreSQL owner session.
  const outboxPass =
    options.enableOutbox === true
      ? createProductionNeonOutboxOperation({
          workerId: options.workerId,
          connectionString: options.workerConnectionString,
          environment,
        })
      : undefined;

  const githubReconciliationPass =
    options.enableGitHubReconciliation === true
      ? createProductionNeonReconciliationOperation({
          workerId: options.workerId,
          connectionString: options.workerConnectionString,
          environment,
        })
      : undefined;
  return createExclusiveNeonScheduledWorkerHandler({
    triggerId: options.triggerId,
    connectionString: options.connectionString,
    createOperations(signal) {
      return {
        async lifecycle() {
          // The ownership session is already held, so these transactions must
          // use the existing durable SQL stores rather than a second job queue.
          const executor = createPgQueryExecutor({ connectionString: options.workerConnectionString, max: 2 });
          try {
            const jobs = createSqlControlPlaneJobStore(executor);
            const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(executor);
            const setup = createProductionRepositorySetupLifecycleExecutor(executor, environment);
            const commands = createProductionGitHubCommandLifecycleExecutor(environment);
            if (!setup || !commands) throw new Error("GitHub App lifecycle executors are unavailable");
            const interactions: NonNullable<ControlPlaneWorkerDependencies["interactions"]> = {
              createSetupPr: setup.createSetupPr,
              probeSetup: setup.probeSetup,
              createWaiverPr: setup.createWaiverPr,
              prepareRelease: setup.prepareRelease,
              executeGitHubCommand: commands.executeGitHubCommand,
            };
            await runClaimedLifecycleBatch({
              workerId: options.workerId,
              limit,
              signal,
              claimJobs: (input) => jobs.claimJobs(input),
              process: (job) =>
                processControlPlaneJob(job, { jobs, lifecycle, workerId: options.workerId, interactions }),
            });
          } finally {
            await executor.close();
          }
        },
        // This is a dedicated lifecycle-only schedule, not a claim that the
        // remaining six continuous-worker queues have moved to Neon.
        outbox: outboxPass ? () => outboxPass(signal) : noop,
        artifactDeletion: noop,
        stripe: noop,
        lifecycleReconciliation: noop,
        githubReconciliation: githubReconciliationPass ? () => githubReconciliationPass(signal) : noop,
        maintenance: noop,
      };
    },
  });
}
