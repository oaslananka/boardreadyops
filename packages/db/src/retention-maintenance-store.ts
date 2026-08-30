import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RetentionMaintenanceStore = {
  purgeExpiredRunnerRequestNonces(input?: { limit?: number }): Promise<number>;
  expireArtifactUploadCapabilities(input?: { limit?: number }): Promise<number>;
  revokeExpiredRunnerRegistrationEnrollments(input?: { limit?: number }): Promise<number>;
  expireRepositorySetupProbes(input?: { limit?: number }): Promise<number>;
  purgeTerminalArtifactUploadCapabilities(input: { retentionDays: number; limit?: number }): Promise<number>;
  purgeTerminalRunnerRegistrationEnrollments(input: { retentionDays: number; limit?: number }): Promise<number>;
  purgeTerminalRepositorySetupProbes(input: { retentionDays: number; limit?: number }): Promise<number>;
  purgeCompletedControlPlaneOutbox(input: { retentionDays: number; limit?: number }): Promise<number>;
  purgeCompletedControlPlaneReconciliationItems(input: { retentionDays: number; limit?: number }): Promise<number>;
  previewExpiredArtifactRetention(input?: { limit?: number }): Promise<number>;
};

export type RetentionMaintenanceStoreOptions = {
  now?: () => Date;
  defaultBatchSize?: number;
};

const maximumBatchSize = 10_000;
const maximumRetentionDays = 3_650;
const millisecondsPerDay = 86_400_000;

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

function retentionCutoff(at: Date, retentionDays: number): string {
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("retentionDays must be a positive integer");
  }
  if (retentionDays > maximumRetentionDays) {
    throw new Error(`retentionDays must be between 1 and ${maximumRetentionDays}`);
  }
  return new Date(at.getTime() - retentionDays * millisecondsPerDay).toISOString();
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

    async purgeTerminalArtifactUploadCapabilities(input) {
      const cutoff = retentionCutoff(now(), input.retentionDays);
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with terminal as (
           select runner_artifact_upload_capabilities.artifact_id
           from runner_artifact_upload_capabilities
           where runner_artifact_upload_capabilities.status in ('uploaded', 'failed', 'expired', 'revoked')
             and coalesce(
               runner_artifact_upload_capabilities.uploaded_at,
               runner_artifact_upload_capabilities.failed_at
             ) <= $1::timestamptz
           order by coalesce(
                      runner_artifact_upload_capabilities.uploaded_at,
                      runner_artifact_upload_capabilities.failed_at
                    ) asc,
                    runner_artifact_upload_capabilities.artifact_id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from runner_artifact_upload_capabilities
           using terminal
           where runner_artifact_upload_capabilities.artifact_id = terminal.artifact_id
           returning runner_artifact_upload_capabilities.artifact_id
         )
         select count(*)::int as affected from deleted`,
        [cutoff, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async purgeTerminalRunnerRegistrationEnrollments(input) {
      const cutoff = retentionCutoff(now(), input.retentionDays);
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with terminal as (
           select runner_registration_enrollments.id
           from runner_registration_enrollments
           where (
               runner_registration_enrollments.consumed_at is not null
               or runner_registration_enrollments.revoked_at is not null
             )
             and coalesce(
               runner_registration_enrollments.consumed_at,
               runner_registration_enrollments.revoked_at
             ) <= $1::timestamptz
           order by coalesce(
                      runner_registration_enrollments.consumed_at,
                      runner_registration_enrollments.revoked_at
                    ) asc,
                    runner_registration_enrollments.id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from runner_registration_enrollments
           using terminal
           where runner_registration_enrollments.id = terminal.id
           returning runner_registration_enrollments.id
         )
         select count(*)::int as affected from deleted`,
        [cutoff, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async purgeTerminalRepositorySetupProbes(input) {
      const cutoff = retentionCutoff(now(), input.retentionDays);
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with terminal as (
           select repository_setup_probes.id
           from repository_setup_probes
           where repository_setup_probes.status in ('completed', 'failed', 'expired')
             and repository_setup_probes.completed_at <= $1::timestamptz
           order by repository_setup_probes.completed_at asc, repository_setup_probes.id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from repository_setup_probes
           using terminal
           where repository_setup_probes.id = terminal.id
           returning repository_setup_probes.id
         )
         select count(*)::int as affected from deleted`,
        [cutoff, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async purgeCompletedControlPlaneOutbox(input) {
      const cutoff = retentionCutoff(now(), input.retentionDays);
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `select boardreadyops_purge_completed_control_plane_outbox(
           $1::timestamptz,
           $2::integer
         )::int as affected`,
        [cutoff, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async previewExpiredArtifactRetention(input = {}) {
      const at = now().toISOString();
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with candidates as (
           select artifacts.id
           from artifacts
           join release_runs on release_runs.id = artifacts.run_id
           join repositories on repositories.id = release_runs.repository_id
           join installations on installations.id = repositories.installation_id
           left join retention_policies on retention_policies.tenant_id = installations.account_login
           where (
             artifacts.retention_until <= $1::timestamptz
             or (
               artifacts.retention_until is null
               and case
                   when retention_policies.retention_days is not null then retention_policies.retention_days
                   when installations.plan_tier = 'free' then 30
                   when installations.plan_tier = 'team' then 365
                   else null
                 end is not null
               and artifacts.uploaded_at <= $1::timestamptz - make_interval(
                 days => case
                   when retention_policies.retention_days is not null then retention_policies.retention_days
                   when installations.plan_tier = 'free' then 30
                   when installations.plan_tier = 'team' then 365
                   else null
                 end
               )
             )
           )
             and not exists (
               select 1
               from legal_holds
               where legal_holds.tenant_id = installations.account_login
                 and legal_holds.active = true
             )
           limit $2::integer
         )
         select count(*)::int as affected from candidates`,
        [at, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },

    async purgeCompletedControlPlaneReconciliationItems(input) {
      const cutoff = retentionCutoff(now(), input.retentionDays);
      const limit = boundedLimit(input.limit, defaultBatchSize);
      const result = await executor.query(
        `with terminal as (
           select control_plane_reconciliation_items.id
           from control_plane_reconciliation_items
           where control_plane_reconciliation_items.status = 'completed'
             and control_plane_reconciliation_items.completed_at <= $1::timestamptz
           order by control_plane_reconciliation_items.completed_at asc,
                    control_plane_reconciliation_items.id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from control_plane_reconciliation_items
           using terminal
           where control_plane_reconciliation_items.id = terminal.id
           returning control_plane_reconciliation_items.id
         )
         select count(*)::int as affected from deleted`,
        [cutoff, limit],
      );
      return nonNegativeInteger(rows(result)[0]?.affected);
    },
  };
}
