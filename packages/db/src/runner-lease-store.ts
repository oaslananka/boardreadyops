import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RunnerWorkerIdentity =
  | { workerClass: "managed"; managedRunnerIdentityId: string }
  | { workerClass: "self_hosted"; runnerRegistrationId: string };

export type RunnerLeaseStoreOptions = {
  now?: () => Date;
  id?: () => string;
  leaseToken?: () => string;
  leaseDurationSeconds?: number;
  maximumLeaseDurationSeconds?: number;
  requestToleranceSeconds?: number;
  requestNonceTtlSeconds?: number;
  emptyRetryAfterSeconds?: number;
};

export type RunnerSignedMutation = {
  requestTimestamp: number;
  requestNonce: string;
};

export type ClaimRunnerJobInput = RunnerWorkerIdentity &
  RunnerSignedMutation & {
    capabilities?: readonly string[];
  };

export type ClaimedRunnerJob = {
  status: "claimed";
  leaseId: string;
  leaseToken: string;
  runId: string;
  executionAttemptId: string;
  leaseExpiresAt: string;
  maximumLeaseExpiresAt: string;
  sourceMode: "broker" | "customer_checkout";
  repository: {
    owner: string;
    name: string;
    commitSha: string;
    private: boolean;
  };
  safeMode: {
    enabled: boolean;
    reasons: readonly ("private-repository")[];
  };
};

export type ClaimRunnerJobResult =
  | ClaimedRunnerJob
  | { status: "empty"; retryAfterSeconds: number }
  | { status: "replayed" }
  | { status: "rejected"; reason: "stale_request" | "invalid_request" };

export type RunnerLeaseStage = "claimed" | "preparing_source" | "reporting" | "running" | "uploading_artifacts";

export type RunnerLeaseMutationContext = RunnerWorkerIdentity &
  RunnerSignedMutation & {
    runId: string;
    executionAttemptId: string;
    leaseId: string;
    leaseToken: string;
  };

export type HeartbeatRunnerLeaseInput = RunnerLeaseMutationContext & {
  stage: RunnerLeaseStage;
  progressPercent?: number;
  message?: string;
};

export type HeartbeatRunnerLeaseResult =
  | { status: "active"; leaseExpiresAt: string; maximumLeaseExpiresAt: string }
  | { status: "completed" | "expired" | "replayed" | "revoked" | "stale" };

export type RelinquishRunnerLeaseInput = RunnerLeaseMutationContext & {
  reason: "capacity" | "job_error" | "operator" | "shutdown";
  message?: string;
};

export type RelinquishRunnerLeaseResult = { status: "accepted" | "replayed" | "stale" };

export type RunnerLeaseStore = {
  claimJob(input: ClaimRunnerJobInput): Promise<ClaimRunnerJobResult>;
  heartbeat(input: HeartbeatRunnerLeaseInput): Promise<HeartbeatRunnerLeaseResult>;
  relinquish(input: RelinquishRunnerLeaseInput): Promise<RelinquishRunnerLeaseResult>;
  expireLeases(): Promise<number>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const capabilityPattern = /^[a-z0-9][a-z0-9._:-]*$/u;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanColumn(row: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = row?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberColumn(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

function isoColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return selected;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function identityParameters(identity: RunnerWorkerIdentity): [string, string | null, string | null] {
  return identity.workerClass === "managed"
    ? ["managed", null, identity.managedRunnerIdentityId]
    : ["self_hosted", identity.runnerRegistrationId, null];
}

function validIdentity(identity: RunnerWorkerIdentity): boolean {
  return identity.workerClass === "managed"
    ? uuidPattern.test(identity.managedRunnerIdentityId)
    : uuidPattern.test(identity.runnerRegistrationId);
}

function validSignedMutation(input: RunnerSignedMutation, now: Date, toleranceSeconds: number): boolean {
  if (!Number.isSafeInteger(input.requestTimestamp) || input.requestTimestamp < 0) return false;
  if (input.requestNonce.length < 22 || input.requestNonce.length > 128 || !base64UrlPattern.test(input.requestNonce)) {
    return false;
  }
  return Math.abs(Math.floor(now.valueOf() / 1000) - input.requestTimestamp) <= toleranceSeconds;
}

function validLeaseContext(input: RunnerLeaseMutationContext): boolean {
  return (
    validIdentity(input) &&
    uuidPattern.test(input.runId) &&
    uuidPattern.test(input.executionAttemptId) &&
    uuidPattern.test(input.leaseId) &&
    input.leaseToken.length >= 43 &&
    input.leaseToken.length <= 256 &&
    base64UrlPattern.test(input.leaseToken)
  );
}

function normalizedCapabilities(capabilities: readonly string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set(capabilities ?? [])).sort();
  if (normalized.length > 64 || normalized.some((capability) => !capabilityPattern.test(capability))) {
    return undefined;
  }
  return normalized;
}

function stageRank(stage: RunnerLeaseStage): number {
  switch (stage) {
    case "claimed":
      return 0;
    case "preparing_source":
      return 1;
    case "running":
      return 2;
    case "uploading_artifacts":
      return 3;
    case "reporting":
      return 4;
  }
}

export function createSqlRunnerLeaseStore(
  executor: SqlQueryExecutor,
  options: RunnerLeaseStoreOptions = {},
): RunnerLeaseStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const leaseToken = options.leaseToken ?? (() => randomBytes(32).toString("base64url"));
  const leaseDurationSeconds = positiveInteger(options.leaseDurationSeconds, 120, "leaseDurationSeconds");
  const maximumLeaseDurationSeconds = positiveInteger(
    options.maximumLeaseDurationSeconds,
    1800,
    "maximumLeaseDurationSeconds",
  );
  const requestToleranceSeconds = positiveInteger(options.requestToleranceSeconds, 300, "requestToleranceSeconds");
  const requestNonceTtlSeconds = positiveInteger(options.requestNonceTtlSeconds, 600, "requestNonceTtlSeconds");
  const emptyRetryAfterSeconds = positiveInteger(options.emptyRetryAfterSeconds, 15, "emptyRetryAfterSeconds");

  if (maximumLeaseDurationSeconds < leaseDurationSeconds) {
    throw new Error("maximumLeaseDurationSeconds must be greater than or equal to leaseDurationSeconds");
  }

  async function pruneExpiredNonces(at: Date): Promise<void> {
    await executor.query("delete from runner_request_nonces where expires_at <= $1::timestamptz", [at.toISOString()]);
  }

  async function expireLeasesAt(at: Date): Promise<number> {
    const result = await executor.query(
      `with expired_leases as (
         update runner_job_leases
         set status = 'expired',
             closed_at = $1::timestamptz,
             close_reason = coalesce(close_reason, 'Lease expired before a valid heartbeat renewed it.')
         where status = 'active'
           and expires_at <= $1::timestamptz
         returning id, run_id, execution_attempt_id, worker_class, runner_registration_id,
                   managed_runner_identity_id
       ),
       stale_attempts as (
         update release_run_attempts
         set status = 'stale',
             completed_at = coalesce(completed_at, $1::timestamptz),
             failure_class = coalesce(failure_class, 'lease_expired'),
             failure_message = coalesce(failure_message, 'The runner lease expired before completion.')
         from expired_leases
         where release_run_attempts.id = expired_leases.execution_attempt_id
           and release_run_attempts.run_id = expired_leases.run_id
           and release_run_attempts.status in (
             'queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting'
           )
         returning release_run_attempts.id, release_run_attempts.run_id
       ),
       requeued_runs as (
         update release_runs
         set status = 'queued'
         from stale_attempts
         where release_runs.id = stale_attempts.run_id
           and release_runs.execution_attempt_id = stale_attempts.id
           and release_runs.status = 'running'
         returning release_runs.id, release_runs.repository_id
       ),
       inserted_audit as (
         insert into audit_events (
           installation_id, event_type, actor_type, subject_type, subject_id,
           repository_id, release_run_id, runner_registration_id, metadata
         )
         select repositories.installation_id,
                'runner.lease.expired',
                'system',
                'runner_lease',
                expired_leases.id,
                release_runs.repository_id,
                release_runs.id,
                expired_leases.runner_registration_id,
                jsonb_build_object(
                  'executionAttemptId', expired_leases.execution_attempt_id,
                  'workerClass', expired_leases.worker_class,
                  'managedRunnerIdentityId', expired_leases.managed_runner_identity_id
                )
         from expired_leases
         join release_runs on release_runs.id = expired_leases.run_id
         join repositories on repositories.id = release_runs.repository_id
         returning id
       )
       select count(*)::int as expired_count from expired_leases`,
      [at.toISOString()],
    );

    return numberColumn(rows(result)[0], "expired_count") ?? 0;
  }

  return {
    async expireLeases() {
      const at = now();
      await pruneExpiredNonces(at);
      return await expireLeasesAt(at);
    },

    async claimJob(input) {
      const at = now();
      const capabilities = normalizedCapabilities(input.capabilities);
      if (!validIdentity(input) || capabilities === undefined) {
        return { status: "rejected", reason: "invalid_request" };
      }
      if (!validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "rejected", reason: "stale_request" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const attemptId = id();
      const leaseId = id();
      const token = leaseToken();
      if (
        !uuidPattern.test(attemptId) ||
        !uuidPattern.test(leaseId) ||
        token.length < 43 ||
        token.length > 256 ||
        !base64UrlPattern.test(token)
      ) {
        throw new Error("runner lease identity generator returned an invalid value");
      }

      const expiresAt = new Date(at.valueOf() + leaseDurationSeconds * 1000);
      const maximumExpiresAt = new Date(at.valueOf() + maximumLeaseDurationSeconds * 1000);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);

      const result = await executor.query(
        `with self_hosted_identity as materialized (
           select 'self_hosted'::text as worker_class,
                  runner_registrations.id as runner_registration_id,
                  null::text as managed_runner_identity_id,
                  runner_registrations.installation_id,
                  runner_registrations.allowed_repositories
           from runner_registrations
           where $2 = 'self_hosted'
             and runner_registrations.id = $3
             and runner_registrations.status = 'active'
             and runner_registrations.disabled_at is null
             and runner_registrations.public_key is not null
             and runner_registrations.capabilities @> $5::jsonb
         ),
         managed_identity as materialized (
           select 'managed'::text as worker_class,
                  null::text as runner_registration_id,
                  managed_runner_identities.id as managed_runner_identity_id,
                  null::text as installation_id,
                  '{}'::text[] as allowed_repositories
           from managed_runner_identities
           where $2 = 'managed'
             and managed_runner_identities.id = $4
             and managed_runner_identities.status = 'active'
             and managed_runner_identities.disabled_at is null
             and managed_runner_identities.capabilities @> $5::jsonb
         ),
         identity as materialized (
           select * from self_hosted_identity
           union all
           select * from managed_identity
         ),
         accepted_nonce as (
           insert into runner_request_nonces (
             worker_class, runner_registration_id, managed_runner_identity_id,
             nonce_digest, request_timestamp, expires_at
           )
           select identity.worker_class,
                  identity.runner_registration_id,
                  identity.managed_runner_identity_id,
                  $6,
                  $7::timestamptz,
                  $8::timestamptz
           from identity
           on conflict do nothing
           returning id
         ),
         candidate as materialized (
           select release_runs.id as run_id,
                  release_runs.repository_id,
                  release_runs.commit_sha,
                  repositories.owner,
                  repositories.name,
                  repositories.private,
                  repositories.installation_id,
                  identity.worker_class,
                  identity.runner_registration_id,
                  identity.managed_runner_identity_id
           from release_runs
           join repositories on repositories.id = release_runs.repository_id
           join installations on installations.id = repositories.installation_id
           cross join identity
           cross join accepted_nonce
           left join release_run_attempts current_attempt
             on current_attempt.id = release_runs.execution_attempt_id
           where release_runs.status in ('queued', 'running')
             and repositories.disabled_at is null
             and installations.suspended_at is null
             and (
               release_runs.execution_attempt_id is null
               or current_attempt.status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
             )
             and (
               identity.worker_class = 'managed'
               or (
                 repositories.installation_id = identity.installation_id
                 and (
                   cardinality(identity.allowed_repositories) = 0
                   or exists (
                     select 1
                     from unnest(identity.allowed_repositories) allowed_repository
                     where lower(allowed_repository) = lower(repositories.owner || '/' || repositories.name)
                   )
                 )
               )
             )
           order by release_runs.started_at, release_runs.id
           for update of release_runs skip locked
           limit 1
         ),
         numbered as materialized (
           select candidate.*,
                  (
                    select coalesce(max(release_run_attempts.attempt_number), 0) + 1
                    from release_run_attempts
                    where release_run_attempts.run_id = candidate.run_id
                  ) as attempt_number
           from candidate
         ),
         inserted_attempt as (
           insert into release_run_attempts (
             id, run_id, attempt_number, status, created_at, dispatch_requested_at,
             dispatched_at, started_at, heartbeat_at
           )
           select $9, numbered.run_id, numbered.attempt_number, 'in_progress',
                  $1::timestamptz, $1::timestamptz, $1::timestamptz,
                  $1::timestamptz, $1::timestamptz
           from numbered
           returning id, run_id
         ),
         updated_run as (
           update release_runs
           set execution_attempt_id = inserted_attempt.id,
               execution_attempt_started_at = $1::timestamptz,
               status = 'running'
           from inserted_attempt
           where release_runs.id = inserted_attempt.run_id
           returning release_runs.id
         ),
         inserted_lease as (
           insert into runner_job_leases (
             id, run_id, execution_attempt_id, worker_class, runner_registration_id,
             managed_runner_identity_id, lease_token_digest, status, stage,
             claimed_at, heartbeat_at, expires_at, maximum_expires_at
           )
           select $10, numbered.run_id, inserted_attempt.id, numbered.worker_class,
                  numbered.runner_registration_id, numbered.managed_runner_identity_id,
                  $11, 'active', 'claimed', $1::timestamptz, $1::timestamptz,
                  $12::timestamptz, $13::timestamptz
           from numbered
           join inserted_attempt on inserted_attempt.run_id = numbered.run_id
           returning id, run_id, execution_attempt_id, expires_at, maximum_expires_at
         ),
         updated_identity as (
           update runner_registrations
           set last_heartbeat_at = $1::timestamptz
           from inserted_lease
           where runner_registrations.id = $3
             and $2 = 'self_hosted'
           returning runner_registrations.id
         ),
         updated_managed_identity as (
           update managed_runner_identities
           set last_heartbeat_at = $1::timestamptz
           from inserted_lease
           where managed_runner_identities.id = $4
             and $2 = 'managed'
           returning managed_runner_identities.id
         ),
         inserted_audit as (
           insert into audit_events (
             installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
             repository_id, release_run_id, runner_registration_id, metadata
           )
           select numbered.installation_id,
                  'runner.lease.claimed',
                  case when numbered.worker_class = 'managed' then 'managed_runner' else 'runner' end,
                  coalesce(numbered.managed_runner_identity_id, numbered.runner_registration_id),
                  'runner_lease',
                  inserted_lease.id,
                  numbered.repository_id,
                  numbered.run_id,
                  numbered.runner_registration_id,
                  jsonb_build_object(
                    'executionAttemptId', inserted_lease.execution_attempt_id,
                    'workerClass', numbered.worker_class,
                    'expiresAt', inserted_lease.expires_at,
                    'maximumExpiresAt', inserted_lease.maximum_expires_at
                  )
           from numbered
           join inserted_lease on inserted_lease.run_id = numbered.run_id
           returning id
         )
         select case
                  when not exists (select 1 from accepted_nonce) then 'replayed'
                  when not exists (select 1 from inserted_lease) then 'empty'
                  else 'claimed'
                end as outcome,
                inserted_lease.id as lease_id,
                inserted_lease.run_id,
                inserted_lease.execution_attempt_id,
                inserted_lease.expires_at,
                inserted_lease.maximum_expires_at,
                numbered.worker_class,
                numbered.owner,
                numbered.name,
                numbered.commit_sha,
                numbered.private
         from (select 1) singleton
         left join inserted_lease on true
         left join numbered on numbered.run_id = inserted_lease.run_id`,
        [
          at.toISOString(),
          workerClass,
          runnerRegistrationId,
          managedRunnerIdentityId,
          JSON.stringify(capabilities),
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          attemptId,
          leaseId,
          digest(token),
          expiresAt.toISOString(),
          maximumExpiresAt.toISOString(),
        ],
      );

      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      if (outcome === "replayed") return { status: "replayed" };
      if (outcome !== "claimed") return { status: "empty", retryAfterSeconds: emptyRetryAfterSeconds };

      const returnedLeaseId = stringColumn(row, "lease_id");
      const runId = stringColumn(row, "run_id");
      const executionAttemptId = stringColumn(row, "execution_attempt_id");
      const leaseExpiresAt = isoColumn(row, "expires_at");
      const maximumLeaseExpiresAt = isoColumn(row, "maximum_expires_at");
      const owner = stringColumn(row, "owner");
      const name = stringColumn(row, "name");
      const commitSha = stringColumn(row, "commit_sha");
      const privateRepository = booleanColumn(row, "private");
      if (
        !returnedLeaseId ||
        !runId ||
        !executionAttemptId ||
        !leaseExpiresAt ||
        !maximumLeaseExpiresAt ||
        !owner ||
        !name ||
        !commitSha ||
        privateRepository === undefined
      ) {
        throw new Error("runner claim did not return a complete lease record");
      }

      return {
        status: "claimed",
        leaseId: returnedLeaseId,
        leaseToken: token,
        runId,
        executionAttemptId,
        leaseExpiresAt,
        maximumLeaseExpiresAt,
        sourceMode: input.workerClass === "managed" ? "broker" : "customer_checkout",
        repository: { owner, name, commitSha, private: privateRepository },
        safeMode: {
          enabled: privateRepository,
          reasons: privateRepository ? ["private-repository"] : [],
        },
      };
    },

    async heartbeat(input) {
      const at = now();
      if (!validLeaseContext(input) || !validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "stale" };
      }
      if (
        !Number.isInteger(input.progressPercent ?? 0) ||
        (input.progressPercent !== undefined && (input.progressPercent < 0 || input.progressPercent > 100)) ||
        (input.message !== undefined && (input.message.trim().length === 0 || input.message.length > 500))
      ) {
        return { status: "stale" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const extensionExpiresAt = new Date(at.valueOf() + leaseDurationSeconds * 1000);

      const result = await executor.query(
        `with matching_lease as materialized (
           select runner_job_leases.id
           from runner_job_leases
           join release_runs on release_runs.id = runner_job_leases.run_id
           where runner_job_leases.id = $5
             and runner_job_leases.run_id = $3
             and runner_job_leases.execution_attempt_id = $4
             and runner_job_leases.worker_class = $2
             and runner_job_leases.runner_registration_id is not distinct from $6
             and runner_job_leases.managed_runner_identity_id is not distinct from $7
             and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
         ),
         accepted_nonce as (
           insert into runner_request_nonces (
             worker_class, runner_registration_id, managed_runner_identity_id,
             runner_job_lease_id, nonce_digest, request_timestamp, expires_at
           )
           select $2, $6, $7, matching_lease.id, $8, $9::timestamptz, $10::timestamptz
           from matching_lease
           on conflict do nothing
           returning id
         ),
         updated_lease as (
           update runner_job_leases
           set heartbeat_at = $1::timestamptz,
               expires_at = least(maximum_expires_at, $11::timestamptz),
               stage = case
                 when case $12
                   when 'claimed' then 0
                   when 'preparing_source' then 1
                   when 'running' then 2
                   when 'uploading_artifacts' then 3
                   when 'reporting' then 4
                 end >= case runner_job_leases.stage
                   when 'claimed' then 0
                   when 'preparing_source' then 1
                   when 'running' then 2
                   when 'uploading_artifacts' then 3
                   when 'reporting' then 4
                 end then $12
                 else runner_job_leases.stage
               end,
               progress_percent = case
                 when $13::integer is null then runner_job_leases.progress_percent
                 else greatest(coalesce(runner_job_leases.progress_percent, 0), $13::integer)
               end,
               last_message = coalesce($14, runner_job_leases.last_message)
           from accepted_nonce
           where runner_job_leases.id = $5
             and runner_job_leases.status = 'active'
             and runner_job_leases.expires_at > $1::timestamptz
             and runner_job_leases.lease_token_digest = $15
           returning runner_job_leases.*
         ),
         updated_attempt as (
           update release_run_attempts
           set heartbeat_at = $1::timestamptz,
               status = case updated_lease.stage
                 when 'uploading_artifacts' then 'uploading_artifacts'
                 when 'reporting' then 'reporting'
                 else 'in_progress'
               end
           from updated_lease
           where release_run_attempts.id = updated_lease.execution_attempt_id
             and release_run_attempts.run_id = updated_lease.run_id
             and release_run_attempts.status in ('in_progress', 'uploading_artifacts', 'reporting')
           returning release_run_attempts.id
         ),
         updated_self_hosted_identity as (
           update runner_registrations
           set last_heartbeat_at = $1::timestamptz
           from updated_lease
           where runner_registrations.id = updated_lease.runner_registration_id
           returning runner_registrations.id
         ),
         updated_managed_identity as (
           update managed_runner_identities
           set last_heartbeat_at = $1::timestamptz
           from updated_lease
           where managed_runner_identities.id = updated_lease.managed_runner_identity_id
           returning managed_runner_identities.id
         ),
         inserted_audit as (
           insert into audit_events (
             installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
             repository_id, release_run_id, runner_registration_id, metadata
           )
           select repositories.installation_id,
                  'runner.lease.renewed',
                  case when updated_lease.worker_class = 'managed' then 'managed_runner' else 'runner' end,
                  coalesce(updated_lease.managed_runner_identity_id, updated_lease.runner_registration_id),
                  'runner_lease',
                  updated_lease.id,
                  release_runs.repository_id,
                  release_runs.id,
                  updated_lease.runner_registration_id,
                  jsonb_build_object(
                    'executionAttemptId', updated_lease.execution_attempt_id,
                    'stage', updated_lease.stage,
                    'progressPercent', updated_lease.progress_percent,
                    'expiresAt', updated_lease.expires_at
                  )
           from updated_lease
           join release_runs on release_runs.id = updated_lease.run_id
           join repositories on repositories.id = release_runs.repository_id
           returning id
         )
         select 'active'::text as outcome, expires_at, maximum_expires_at
         from updated_lease
         union all
         select case
                  when not exists (select 1 from accepted_nonce)
                    and exists (select 1 from matching_lease) then 'replayed'
                  when runner_job_leases.status = 'expired' then 'expired'
                  when runner_job_leases.status = 'revoked' then 'revoked'
                  when runner_job_leases.status = 'completed' then 'completed'
                  else 'stale'
                end,
                runner_job_leases.expires_at,
                runner_job_leases.maximum_expires_at
         from runner_job_leases
         where runner_job_leases.id = $5
           and runner_job_leases.run_id = $3
           and runner_job_leases.execution_attempt_id = $4
           and runner_job_leases.worker_class = $2
           and runner_job_leases.runner_registration_id is not distinct from $6
           and runner_job_leases.managed_runner_identity_id is not distinct from $7
           and runner_job_leases.lease_token_digest = $15
           and not exists (select 1 from updated_lease)
         limit 1`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          extensionExpiresAt.toISOString(),
          input.stage,
          input.progressPercent ?? null,
          input.message?.trim() ?? null,
          digest(input.leaseToken),
        ],
      );

      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      if (outcome === "active") {
        const leaseExpiresAt = isoColumn(row, "expires_at");
        const maximumLeaseExpiresAt = isoColumn(row, "maximum_expires_at");
        if (!leaseExpiresAt || !maximumLeaseExpiresAt) throw new Error("lease heartbeat returned invalid expiry data");
        return { status: "active", leaseExpiresAt, maximumLeaseExpiresAt };
      }
      if (outcome === "expired" || outcome === "revoked" || outcome === "completed" || outcome === "replayed") {
        return { status: outcome };
      }
      return { status: "stale" };
    },

    async relinquish(input) {
      const at = now();
      if (!validLeaseContext(input) || !validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "stale" };
      }
      if (input.message !== undefined && (input.message.trim().length === 0 || input.message.length > 1000)) {
        return { status: "stale" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const attemptStatus = input.reason === "job_error" ? "failed" : "stale";

      const result = await executor.query(
        `with matching_lease as materialized (
           select runner_job_leases.id
           from runner_job_leases
           where runner_job_leases.id = $5
             and runner_job_leases.run_id = $3
             and runner_job_leases.execution_attempt_id = $4
             and runner_job_leases.worker_class = $2
             and runner_job_leases.runner_registration_id is not distinct from $6
             and runner_job_leases.managed_runner_identity_id is not distinct from $7
         ),
         accepted_nonce as (
           insert into runner_request_nonces (
             worker_class, runner_registration_id, managed_runner_identity_id,
             runner_job_lease_id, nonce_digest, request_timestamp, expires_at
           )
           select $2, $6, $7, matching_lease.id, $8, $9::timestamptz, $10::timestamptz
           from matching_lease
           on conflict do nothing
           returning id
         ),
         closed_lease as (
           update runner_job_leases
           set status = 'relinquished',
               closed_at = $1::timestamptz,
               close_reason = coalesce($11, $12)
           from accepted_nonce
           where runner_job_leases.id = $5
             and runner_job_leases.status = 'active'
             and runner_job_leases.expires_at > $1::timestamptz
             and runner_job_leases.lease_token_digest = $13
           returning runner_job_leases.*
         ),
         closed_attempt as (
           update release_run_attempts
           set status = $14,
               completed_at = coalesce(completed_at, $1::timestamptz),
               failure_class = coalesce(failure_class, 'runner_relinquished'),
               failure_message = coalesce(failure_message, $12)
           from closed_lease
           where release_run_attempts.id = closed_lease.execution_attempt_id
             and release_run_attempts.run_id = closed_lease.run_id
             and release_run_attempts.status in ('in_progress', 'uploading_artifacts', 'reporting')
           returning release_run_attempts.id, release_run_attempts.run_id
         ),
         requeued_run as (
           update release_runs
           set status = 'queued'
           from closed_attempt
           where release_runs.id = closed_attempt.run_id
             and release_runs.execution_attempt_id = closed_attempt.id
             and release_runs.status = 'running'
           returning release_runs.id, release_runs.repository_id
         ),
         inserted_audit as (
           insert into audit_events (
             installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
             repository_id, release_run_id, runner_registration_id, metadata
           )
           select repositories.installation_id,
                  'runner.lease.relinquished',
                  case when closed_lease.worker_class = 'managed' then 'managed_runner' else 'runner' end,
                  coalesce(closed_lease.managed_runner_identity_id, closed_lease.runner_registration_id),
                  'runner_lease',
                  closed_lease.id,
                  release_runs.repository_id,
                  release_runs.id,
                  closed_lease.runner_registration_id,
                  jsonb_build_object(
                    'executionAttemptId', closed_lease.execution_attempt_id,
                    'reason', $15,
                    'attemptStatus', $14
                  )
           from closed_lease
           join release_runs on release_runs.id = closed_lease.run_id
           join repositories on repositories.id = release_runs.repository_id
           returning id
         )
         select case
                  when exists (select 1 from closed_lease) then 'accepted'
                  when not exists (select 1 from accepted_nonce)
                    and exists (select 1 from matching_lease) then 'replayed'
                  when exists (
                    select 1
                    from runner_job_leases
                    where id = $5
                      and run_id = $3
                      and execution_attempt_id = $4
                      and worker_class = $2
                      and runner_registration_id is not distinct from $6
                      and managed_runner_identity_id is not distinct from $7
                      and lease_token_digest = $13
                      and status = 'relinquished'
                  ) then 'replayed'
                  else 'stale'
                end as outcome`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          input.message?.trim() ?? null,
          `Runner relinquished the lease: ${input.reason}.`,
          digest(input.leaseToken),
          attemptStatus,
          input.reason,
        ],
      );

      const outcome = stringColumn(rows(result)[0], "outcome");
      return outcome === "accepted" || outcome === "replayed" ? { status: outcome } : { status: "stale" };
    },
  };
}
