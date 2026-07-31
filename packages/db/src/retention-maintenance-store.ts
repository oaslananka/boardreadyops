import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RetentionMaintenanceStore = {
  purgeExpiredRunnerRequestNonces(input?: { limit?: number }): Promise<number>;
  expireArtifactUploadCapabilities(input?: { limit?: number }): Promise<number>;
  revokeExpiredRunnerRegistrationEnrollments(input?: { limit?: number }): Promise<number>;
  expireRepositorySetupProbes(input?: { limit?: number }): Promise<number>;
};

export type RetentionMaintenanceStoreOptions = {
  now?: () => Date;
  defaultBatchSize?: number;
};

const maximumBatchSize = 10_000;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive integer`);
  return selected;
}

function boundedLimit(requestedLimit: number | undefined, fallback: number): number {
  return Number.isSafeInteger(requestedLimit) && requestedLimit !== undefined && requestedLimit > 0
    ? Math.min(requestedLimit, maximumBatchSize)
    : fallback;
}

export function createSqlRetentionMaintenanceStore(
  executor: SqlQueryExecutor,
  options: RetentionMaintenanceStoreOptions = {},
): RetentionMaintenanceStore {
  const now = options.now ?? (() => new Date());
  const defaultBatchSize = Math.min(
    positiveInteger(options.defaultBatchSize, 1_000, "defaultBatchSize"),
    maximumBatchSize,
  );

  return {
    async purgeExpiredRunnerRequestNonces(input = {}) {
      const at = now().toISOString();
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with expired as (
           select runner_request_nonces.id
           from runner_request_nonces
           where runner_request_nonces.expires_at <= $1::timestamptz
           order by runner_request_nonces.expires_at asc, runner_request_nonces.id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from runner_request_nonces
           using expired
           where runner_request_nonces.id = expired.id
           returning runner_request_nonces.id
         )
         select count(*)::int as affected from deleted`,
        [at, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async expireArtifactUploadCapabilities(input = {}) {
      const at = now().toISOString();
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with expired as (
           select runner_artifact_upload_capabilities.artifact_id
           from runner_artifact_upload_capabilities
           where runner_artifact_upload_capabilities.status = 'pending'
             and runner_artifact_upload_capabilities.expires_at <= $1::timestamptz
           order by runner_artifact_upload_capabilities.expires_at asc,
                    runner_artifact_upload_capabilities.artifact_id asc
           for update skip locked
           limit $2::integer
         ), updated as (
           update runner_artifact_upload_capabilities as capability
           set status = 'expired',
               failed_at = $1::timestamptz,
               failure_reason = 'Artifact upload capability expired before use.'
           from expired
           where capability.artifact_id = expired.artifact_id
           returning capability.artifact_id
         )
         select count(*)::int as affected from updated`,
        [at, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async revokeExpiredRunnerRegistrationEnrollments(input = {}) {
      const at = now().toISOString();
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with expired as (
           select runner_registration_enrollments.id
           from runner_registration_enrollments
           where runner_registration_enrollments.consumed_at is null
             and runner_registration_enrollments.revoked_at is null
             and runner_registration_enrollments.expires_at <= $1::timestamptz
           order by runner_registration_enrollments.expires_at asc,
                    runner_registration_enrollments.id asc
           for update skip locked
           limit $2::integer
         ), updated as (
           update runner_registration_enrollments as enrollment
           set revoked_at = $1::timestamptz
           from expired
           where enrollment.id = expired.id
           returning enrollment.id
         )
         select count(*)::int as affected from updated`,
        [at, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async expireRepositorySetupProbes(input = {}) {
      const at = now().toISOString();
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with expired as (
           select repository_setup_probes.id
           from repository_setup_probes
           where repository_setup_probes.status in ('pending', 'dispatched')
             and repository_setup_probes.expires_at <= $1::timestamptz
           order by repository_setup_probes.expires_at asc,
                    repository_setup_probes.id asc
           for update skip locked
           limit $2::integer
         ), updated as (
           update repository_setup_probes as probe
           set status = 'expired',
               completed_at = $1::timestamptz
           from expired
           where probe.id = expired.id
           returning probe.id
         )
         select count(*)::int as affected from updated`,
        [at, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },
  };
}
