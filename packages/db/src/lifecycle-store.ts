import { randomUUID } from "node:crypto";
import type { GitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
import { releaseRunIdempotencyKey } from "@boardreadyops/cloud-core/lifecycle-executor";

export type SqlQueryResult = {
  rows?: readonly Record<string, unknown>[];
};

export type SqlQueryExecutor = {
  query(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult | unknown>;
};

export type ReleaseRepositoryRolloutPolicy = {
  allowAllRepositories?: boolean;
  repositories?: readonly string[];
};

export type SqlLifecycleStoreOptions = {
  now?: () => Date;
  id?: () => string;
  releaseRepositoryRolloutPolicy?: ReleaseRepositoryRolloutPolicy;
};

export const releaseRepositoryRolloutEnvName = "BOARDREADYOPS_RELEASE_REPOSITORIES";

type Environment = Record<string, string | undefined>;

function iso(now: () => Date): string {
  return now().toISOString();
}

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

function checkRunColumn(row: Record<string, unknown> | undefined): string | number | null | undefined {
  const value = row?.github_check_run_id;
  return typeof value === "string" || typeof value === "number" || value === null ? value : undefined;
}

function normalizeRepositoryFullName(fullName: string): string | undefined {
  const normalized = fullName.trim().toLowerCase();
  return normalized.includes("/") ? normalized : undefined;
}

export function parseReleaseRepositoryRolloutPolicy(input: string | undefined): ReleaseRepositoryRolloutPolicy {
  const tokens = (input ?? "")
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.some((token) => token === "*" || token === "all")) {
    return { allowAllRepositories: true };
  }

  const repositories = Array.from(
    new Set(
      tokens.flatMap((token) => {
        const normalized = normalizeRepositoryFullName(token);
        return normalized ? [normalized] : [];
      }),
    ),
  );

  return { repositories };
}

function releaseRepositoryRolloutPolicyFromEnvironment(env: Environment): ReleaseRepositoryRolloutPolicy {
  return parseReleaseRepositoryRolloutPolicy(env[releaseRepositoryRolloutEnvName]);
}

function releaseRepositoryEnabled(fullName: string | undefined, policy: ReleaseRepositoryRolloutPolicy): boolean {
  if (!fullName) {
    return false;
  }

  if (policy.allowAllRepositories === true) {
    return true;
  }

  const normalized = normalizeRepositoryFullName(fullName);
  if (!normalized) {
    return false;
  }

  return new Set(policy.repositories ?? []).has(normalized);
}

export function createSqlGitHubAppLifecycleStore(
  executor: SqlQueryExecutor,
  options: SqlLifecycleStoreOptions = {},
): GitHubAppLifecycleStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const releaseRepositoryRolloutPolicy =
    options.releaseRepositoryRolloutPolicy ?? releaseRepositoryRolloutPolicyFromEnvironment(process.env);

  return {
    async upsertInstallation(action) {
      await executor.query(
        `insert into installations (id, github_installation_id, account_login, account_type, created_at, suspended_at)
         values ($1, $2, $3, $4, $5, null)
         on conflict (github_installation_id)
         do update set account_login = excluded.account_login, account_type = excluded.account_type, suspended_at = null`,
        [
          id(),
          action.installation.id,
          action.installation.accountLogin ?? "",
          action.installation.accountType ?? "",
          iso(now),
        ],
      );
    },

    async deleteInstallation(action) {
      await executor.query(
        `update installations
         set suspended_at = $2
         where github_installation_id = $1`,
        [action.installation.id, iso(now)],
      );
    },

    async upsertRepository(action) {
      await executor.query(
        `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch, enabled_at, disabled_at)
         select $8, id, $2, $3, $4, $5, $6, $7, null
         from installations
         where github_installation_id = $1
         on conflict (github_repo_id)
         do update set installation_id = excluded.installation_id, owner = excluded.owner, name = excluded.name, private = excluded.private, default_branch = excluded.default_branch, disabled_at = null`,
        [
          action.installation.id,
          action.repository.id,
          action.repository.owner,
          action.repository.name,
          action.repository.private,
          action.repository.defaultBranch ?? "main",
          iso(now),
          id(),
        ],
      );
    },

    async removeRepository(action) {
      await executor.query(
        `update repositories
         set disabled_at = $3
         where github_repo_id = $1
           and exists (
             select 1 from installations
             where installations.id = repositories.installation_id
               and installations.github_installation_id = $2
           )`,
        [action.repository.id, action.installation.id, iso(now)],
      );
    },

    async enqueueReleaseRun(action) {
      const idempotencyKey = releaseRunIdempotencyKey(action);

      if (!releaseRepositoryEnabled(action.repository.fullName, releaseRepositoryRolloutPolicy)) {
        return { idempotencyKey };
      }

      await executor.query(
        `with superseded_runs as (
           update release_runs
           set status = 'superseded',
               completed_at = coalesce(completed_at, $4::timestamptz)
           from repositories
           where release_runs.repository_id = repositories.id
             and repositories.github_repo_id = $1
             and release_runs.pull_request_number = $2
             and release_runs.commit_sha <> $3
             and release_runs.status in ('queued', 'dispatched', 'running')
           returning release_runs.id
         )
         update release_run_attempts
         set status = 'superseded',
             completed_at = coalesce(completed_at, $4::timestamptz),
             failure_class = coalesce(failure_class, 'newer_commit'),
             failure_message = coalesce(failure_message, 'A newer commit superseded this execution attempt.')
         where release_run_attempts.run_id in (select id from superseded_runs)
           and release_run_attempts.status in (
             'queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting'
           )`,
        [action.repository.id, action.pullRequestNumber, action.commitSha, iso(now)],
      );

      const result = await executor.query(
        `insert into release_runs (id, repository_id, idempotency_key, commit_sha, ref, pull_request_number, trigger_kind, status, started_at)
         select $8, repositories.id, $9, $2, $3, $4, $5, 'queued', $6
         from repositories
         join installations on installations.id = repositories.installation_id
         where repositories.github_repo_id = $1
           and installations.github_installation_id = $7
         on conflict (idempotency_key)
         do update set status = release_runs.status
         returning id, github_check_run_id, status`,
        [
          action.repository.id,
          action.commitSha,
          action.ref,
          action.pullRequestNumber,
          action.triggerKind,
          iso(now),
          action.installation.id,
          id(),
          idempotencyKey,
        ],
      );
      const row = rows(result)[0];

      const enqueued = { idempotencyKey } as {
        idempotencyKey: string;
        runId?: string;
        githubCheckRunId?: string | number | null;
        status?: string;
      };
      const runId = stringColumn(row, "id");
      const githubCheckRunId = checkRunColumn(row);
      const status = stringColumn(row, "status");

      if (runId) {
        enqueued.runId = runId;
      }

      if (githubCheckRunId !== undefined) {
        enqueued.githubCheckRunId = githubCheckRunId;
      }

      if (status) {
        enqueued.status = status;
      }

      return enqueued;
    },

    async attachGitHubCheckRun(input) {
      await executor.query(
        `update release_runs
         set github_check_run_id = $2
         where idempotency_key = $1`,
        [input.idempotencyKey, input.githubCheckRunId],
      );
    },

    async bindReleaseRunExecutionAttempt(input) {
      const result = await executor.query(
        `with target as materialized (
           select release_runs.id, release_runs.execution_attempt_id
           from release_runs
           where release_runs.id = $1
             and release_runs.status = 'queued'
           for update
         ),
         failed_previous as (
           update release_run_attempts
           set status = 'failed',
               completed_at = coalesce(completed_at, $3::timestamptz),
               failure_class = coalesce(failure_class, 'dispatch_replaced'),
               failure_message = coalesce(
                 failure_message,
                 'A newer dispatch attempt replaced this uncompleted attempt.'
               )
           from target
           where release_run_attempts.id = target.execution_attempt_id
             and release_run_attempts.status in ('queued', 'dispatching')
           returning release_run_attempts.id
         ),
         numbered as (
           select target.id as run_id,
                  coalesce(max(release_run_attempts.attempt_number), 0) + 1 as attempt_number
           from target
           left join release_run_attempts on release_run_attempts.run_id = target.id
           group by target.id
         ),
         inserted_attempt as (
           insert into release_run_attempts (
             id, run_id, attempt_number, status, created_at, dispatch_requested_at
           )
           select $2, numbered.run_id, numbered.attempt_number, 'dispatching', $3::timestamptz, $3::timestamptz
           from numbered
           returning id, run_id
         )
         update release_runs
         set execution_attempt_id = inserted_attempt.id,
             execution_attempt_started_at = $3::timestamptz
         from inserted_attempt
         where release_runs.id = inserted_attempt.run_id
         returning release_runs.id`,
        [input.runId, input.executionAttemptId, input.startedAt],
      );

      return rows(result).length === 1;
    },

    async markReleaseRunDispatched(input) {
      await executor.query(
        `with updated_attempt as (
           update release_run_attempts
           set status = 'dispatched',
               dispatched_at = coalesce(release_run_attempts.dispatched_at, $3::timestamptz),
               github_workflow_dispatch_id = coalesce(release_run_attempts.github_workflow_dispatch_id, $4)
           from release_runs
           where release_run_attempts.id = $2
             and release_run_attempts.run_id = $1
             and release_run_attempts.status = 'dispatching'
             and release_runs.id = release_run_attempts.run_id
             and release_runs.execution_attempt_id = release_run_attempts.id
             and release_runs.status = 'queued'
           returning release_run_attempts.id, release_run_attempts.run_id
         )
         update release_runs
         set status = 'dispatched'
         from updated_attempt
         where release_runs.id = updated_attempt.run_id
           and release_runs.execution_attempt_id = updated_attempt.id
           and release_runs.status = 'queued'`,
        [input.runId, input.executionAttemptId, input.dispatchedAt, input.workflowDispatchId ?? null],
      );
    },

    async markReleaseRunSkipped(input) {
      await executor.query(
        `update release_runs
         set status = 'completed',
             decision = 'neutral',
             completed_at = coalesce(completed_at, $2::timestamptz),
             duration_ms = case
               when completed_at is null
                 then greatest(0, floor(extract(epoch from ($2::timestamptz - started_at)) * 1000))::integer
               else duration_ms
             end
         where id = $1
           and status = 'queued'`,
        [input.runId, input.completedAt],
      );
    },
  };
}
