import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RunnerFleetHealthStatus = "degraded" | "healthy" | "not_configured" | "offline";

export type RunnerFleetHealthSnapshot = {
  observedAt: string;
  observationWindowSeconds: number;
  status: RunnerFleetHealthStatus;
  registrations: {
    active: number;
    online: number;
    stale: number;
    versionUnreported: number;
    lastSeenAt?: string;
  };
  queue: {
    pendingJobs: number;
    oldestAgeSeconds?: number;
  };
  leases: {
    active: number;
    earliestExpirySeconds?: number;
  };
  versions: Array<{ version: string; registrations: number }>;
};

export type RunnerFleetHealthStore = {
  readFleetHealth(input: {
    installationId: string;
    observedAt: Date;
    observationWindowSeconds: number;
  }): Promise<RunnerFleetHealthSnapshot | undefined>;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function integerColumn(row: Record<string, unknown>, name: string): number | undefined {
  const value = row[name];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalDate(row: Record<string, unknown>, name: string): Date | undefined {
  const value = row[name];
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) return parsed;
  }
  throw new Error("runner fleet health row is invalid");
}

function validVersion(value: string): boolean {
  return (
    value.length <= 64 &&
    versionPattern.test(value) &&
    value.split(".").every((component) => Number.isSafeInteger(Number(component)))
  );
}

function parsedVersions(value: unknown): Array<{ version: string; registrations: number }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const versions: Array<{ version: string; registrations: number }> = [];
  const seenVersions = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    const version = (entry as Record<string, unknown>).version;
    const registrations = integerColumn(entry as Record<string, unknown>, "registrations");
    if (
      typeof version !== "string" ||
      !validVersion(version) ||
      registrations === undefined ||
      registrations < 1 ||
      seenVersions.has(version)
    ) {
      return undefined;
    }
    seenVersions.add(version);
    versions.push({ version, registrations });
  }
  return versions;
}

function compareVersionsDescending(left: { version: string }, right: { version: string }): number {
  const leftParts = left.version.split(".").map(Number);
  const rightParts = right.version.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function ageSeconds(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.valueOf() - earlier.valueOf()) / 1000));
}

function fleetStatus(active: number, online: number): RunnerFleetHealthStatus {
  if (active === 0) return "not_configured";
  if (online === 0) return "offline";
  return online === active ? "healthy" : "degraded";
}

export function createSqlRunnerFleetHealthStore(executor: SqlQueryExecutor): RunnerFleetHealthStore {
  return {
    async readFleetHealth(input) {
      if (!identifierPattern.test(input.installationId)) throw new Error("installationId is invalid");
      if (!Number.isFinite(input.observedAt.valueOf())) throw new Error("observedAt is invalid");
      if (
        !Number.isSafeInteger(input.observationWindowSeconds) ||
        input.observationWindowSeconds < 1 ||
        input.observationWindowSeconds > 86_400
      ) {
        throw new Error("observationWindowSeconds is invalid");
      }

      const result = await executor.query(
        `with target_installation as (
           select installations.id
             from installations
            where installations.id = $1
         ),
         active_registrations as (
           select runner_registrations.last_heartbeat_at,
                  runner_registrations.last_runner_version
             from runner_registrations
             join target_installation
               on target_installation.id = runner_registrations.installation_id
            where runner_registrations.status = 'active'
              and runner_registrations.disabled_at is null
         ),
         registration_summary as (
           select count(*)::int as active_registrations,
                  count(*) filter (
                    where active_registrations.last_heartbeat_at >
                      $2::timestamptz - make_interval(secs => $3::integer)
                  )::int as online_registrations,
                  count(*) filter (where active_registrations.last_runner_version is null)::int
                    as version_unreported_registrations,
                  max(active_registrations.last_heartbeat_at) as last_seen_at
             from active_registrations
         ),
         version_summary as (
           select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'version', grouped.version,
                        'registrations', grouped.registrations
                      ) order by grouped.version desc
                    ),
                    '[]'::jsonb
                  ) as version_counts
             from (
               select active_registrations.last_runner_version as version,
                      count(*)::int as registrations
                 from active_registrations
                where active_registrations.last_runner_version is not null
                group by active_registrations.last_runner_version
             ) grouped
         ),
         pending_queue as (
           select count(*)::int as pending_jobs,
                  min(release_runs.started_at) as oldest_queued_at
             from release_runs
             join repositories
               on repositories.id = release_runs.repository_id
             join target_installation
               on repositories.installation_id = target_installation.id
             join lateral boardreadyops_effective_runner_policy(
               repositories.installation_id,
               repositories.id
             ) effective_policy on true
             left join release_run_attempts current_attempt
               on current_attempt.id = release_runs.execution_attempt_id
            where release_runs.status in ('queued', 'running')
              and not ('draft-pull-request' = any(release_runs.safe_mode_reasons))
              and not ('fork-pull-request' = any(release_runs.safe_mode_reasons))
              and repositories.disabled_at is null
              and (
                release_runs.execution_attempt_id is null
                or current_attempt.status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
              )
              and effective_policy.policy_mode in ('self_hosted_required', 'self_hosted_preferred')
         ),
         active_lease_summary as (
           select count(*)::int as active_leases,
                  min(runner_job_leases.expires_at) as earliest_lease_expiry_at
             from runner_job_leases
             join release_runs
               on release_runs.id = runner_job_leases.run_id
             join repositories
               on repositories.id = release_runs.repository_id
             join target_installation
               on repositories.installation_id = target_installation.id
            where runner_job_leases.worker_class = 'self_hosted'
              and runner_job_leases.status = 'active'
              and runner_job_leases.expires_at > $2::timestamptz
         )
         select registration_summary.active_registrations,
                registration_summary.online_registrations,
                registration_summary.version_unreported_registrations,
                registration_summary.last_seen_at,
                pending_queue.pending_jobs,
                pending_queue.oldest_queued_at,
                active_lease_summary.active_leases,
                active_lease_summary.earliest_lease_expiry_at,
                version_summary.version_counts
           from target_installation
           cross join registration_summary
           cross join pending_queue
           cross join active_lease_summary
           cross join version_summary`,
        [input.installationId, input.observedAt.toISOString(), input.observationWindowSeconds],
      );

      const row = rows(result)[0];
      if (!row) return undefined;
      const active = integerColumn(row, "active_registrations");
      const online = integerColumn(row, "online_registrations");
      const versionUnreported = integerColumn(row, "version_unreported_registrations");
      const pendingJobs = integerColumn(row, "pending_jobs");
      const activeLeases = integerColumn(row, "active_leases");
      const versions = parsedVersions(row.version_counts);
      if (
        active === undefined ||
        online === undefined ||
        versionUnreported === undefined ||
        pendingJobs === undefined ||
        activeLeases === undefined ||
        versions === undefined ||
        online > active ||
        versionUnreported > active ||
        versions.reduce((total, item) => total + item.registrations, 0) !== active - versionUnreported
      ) {
        throw new Error("runner fleet health row is invalid");
      }

      const lastSeenAt = optionalDate(row, "last_seen_at");
      const oldestQueuedAt = optionalDate(row, "oldest_queued_at");
      const earliestLeaseExpiryAt = optionalDate(row, "earliest_lease_expiry_at");
      if ((active === 0) !== (lastSeenAt === undefined)) {
        throw new Error("runner fleet health row is invalid");
      }
      if ((pendingJobs === 0) !== (oldestQueuedAt === undefined)) {
        throw new Error("runner fleet health row is invalid");
      }
      if ((activeLeases === 0) !== (earliestLeaseExpiryAt === undefined)) {
        throw new Error("runner fleet health row is invalid");
      }

      return {
        observedAt: input.observedAt.toISOString(),
        observationWindowSeconds: input.observationWindowSeconds,
        status: fleetStatus(active, online),
        registrations: {
          active,
          online,
          stale: active - online,
          versionUnreported,
          ...(lastSeenAt ? { lastSeenAt: lastSeenAt.toISOString() } : {}),
        },
        queue: {
          pendingJobs,
          ...(oldestQueuedAt ? { oldestAgeSeconds: ageSeconds(input.observedAt, oldestQueuedAt) } : {}),
        },
        leases: {
          active: activeLeases,
          ...(earliestLeaseExpiryAt
            ? { earliestExpirySeconds: ageSeconds(earliestLeaseExpiryAt, input.observedAt) }
            : {}),
        },
        versions: versions.toSorted(compareVersionsDescending),
      };
    },
  };
}
