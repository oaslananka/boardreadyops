import { createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlRetentionMaintenanceStore } from "@boardreadyops/db/retention-maintenance-store";
import { resolveControlPlaneRetentionConfiguration } from "./cloud-runtime-config.js";
import { purgeExpiredRemoteMcpOAuthSecurityData } from "./remote-mcp-oauth-abuse.js";
import {
  type RetentionMaintenanceDependencies,
  runRetentionMaintenanceCleanup,
} from "./retention-maintenance-worker.js";

type SqlMaintenanceOperations = Omit<RetentionMaintenanceDependencies, "expireArtifactRetention">;

export type NeonSqlMaintenancePassOptions = {
  signal: AbortSignal;
  operations: SqlMaintenanceOperations;
};

/**
 * Reuse the continuous worker's canonical SQL expiry/cleanup tasks under the
 * Neon Function's already-held exclusive PostgreSQL advisory session.
 * Physical artifact retention, deletion queues, and object removal remain
 * with the existing storage-owning worker until storage migration is complete.
 */
export async function runNeonSqlMaintenancePass(options: NeonSqlMaintenancePassOptions): Promise<void> {
  const checkOwner = () => {
    if (options.signal.aborted) throw new Error("worker_ownership_lost");
  };
  checkOwner();
  const guard =
    <T>(operation: () => Promise<T>): (() => Promise<T>) =>
    async () => {
      checkOwner();
      const outcome = await operation();
      checkOwner();
      return outcome;
    };
  const tasks = options.operations;
  const result = await runRetentionMaintenanceCleanup({
    purgeWebhookInbox: guard(tasks.purgeWebhookInbox),
    purgeRunnerRequestNonces: guard(tasks.purgeRunnerRequestNonces),
    purgeRemoteMcpOAuth: guard(tasks.purgeRemoteMcpOAuth),
    expireArtifactUploadCapabilities: guard(tasks.expireArtifactUploadCapabilities),
    revokeExpiredRunnerRegistrationEnrollments: guard(tasks.revokeExpiredRunnerRegistrationEnrollments),
    expireRepositorySetupProbes: guard(tasks.expireRepositorySetupProbes),
    purgeTerminalArtifactUploadCapabilities: guard(tasks.purgeTerminalArtifactUploadCapabilities),
    purgeTerminalRunnerRegistrationEnrollments: guard(tasks.purgeTerminalRunnerRegistrationEnrollments),
    purgeTerminalRepositorySetupProbes: guard(tasks.purgeTerminalRepositorySetupProbes),
    purgeCompletedControlPlaneOutbox: guard(tasks.purgeCompletedControlPlaneOutbox),
    purgeCompletedControlPlaneReconciliationItems: guard(tasks.purgeCompletedControlPlaneReconciliationItems),
    // This SQL-only pass cannot expire managed artifact metadata while its
    // physical deletion worker still requires the original VPS volume.
    expireArtifactRetention: async () => ({
      revokedArtifacts: 0,
      deletionJobsQueued: 0,
      sharedObjectsRetained: 0,
    }),
  });
  checkOwner();
  if (!result.completed) throw new Error("neon_sql_maintenance_incomplete");
}

export type ProductionNeonSqlMaintenanceOptions = {
  connectionString: string;
  batchLimit?: number;
  environment?: Readonly<Record<string, string | undefined>>;
};

/**
 * Opt-in, bounded database-only security/metadata retention, not an object
 * storage sweeper. Uses the same persisted SQL store as the VPS worker.
 */
export function createProductionNeonSqlMaintenanceOperation(
  options: ProductionNeonSqlMaintenanceOptions,
): (signal: AbortSignal) => Promise<void> {
  const limit = options.batchLimit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Neon SQL maintenance batch limit must be between 1 and 100");
  }
  if (!options.connectionString.trim()) throw new Error("A PostgreSQL maintenance URL is required");
  const retention = resolveControlPlaneRetentionConfiguration(
    options.environment
      ? {
          NODE_ENV: "production",
          BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: options.environment.BOARDREADYOPS_WEBHOOK_RETENTION_DAYS,
          BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS:
            options.environment.BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS,
          BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS:
            options.environment.BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS,
        }
      : process.env,
  );
  return async (signal) => {
    if (signal.aborted) throw new Error("worker_ownership_lost");
    const executor = createPgQueryExecutor({ connectionString: options.connectionString, max: 2 });
    try {
      const jobs = createSqlControlPlaneJobStore(executor);
      const store = createSqlRetentionMaintenanceStore(executor, { defaultBatchSize: limit });
      await runNeonSqlMaintenancePass({
        signal,
        operations: {
          purgeWebhookInbox: () => jobs.purgeExpired({ limit }),
          purgeRunnerRequestNonces: () => store.purgeExpiredRunnerRequestNonces({ limit }),
          purgeRemoteMcpOAuth: () => purgeExpiredRemoteMcpOAuthSecurityData(executor, limit),
          expireArtifactUploadCapabilities: () => store.expireArtifactUploadCapabilities({ limit }),
          revokeExpiredRunnerRegistrationEnrollments: () => store.revokeExpiredRunnerRegistrationEnrollments({ limit }),
          expireRepositorySetupProbes: () => store.expireRepositorySetupProbes({ limit }),
          purgeTerminalArtifactUploadCapabilities: () =>
            store.purgeTerminalArtifactUploadCapabilities({ retentionDays: retention.ephemeralRecordsDays, limit }),
          purgeTerminalRunnerRegistrationEnrollments: () =>
            store.purgeTerminalRunnerRegistrationEnrollments({ retentionDays: retention.ephemeralRecordsDays, limit }),
          purgeTerminalRepositorySetupProbes: () =>
            store.purgeTerminalRepositorySetupProbes({ retentionDays: retention.ephemeralRecordsDays, limit }),
          purgeCompletedControlPlaneOutbox: () =>
            store.purgeCompletedControlPlaneOutbox({ retentionDays: retention.controlPlaneHistoryDays, limit }),
          purgeCompletedControlPlaneReconciliationItems: () =>
            store.purgeCompletedControlPlaneReconciliationItems({
              retentionDays: retention.controlPlaneHistoryDays,
              limit,
            }),
        },
      });
    } finally {
      await executor.close();
    }
  };
}
