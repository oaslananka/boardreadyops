import { randomUUID } from "node:crypto";
import type { GitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
import { releaseRunIdempotencyKey } from "@boardreadyops/cloud-core/lifecycle-executor";

export type SqlQueryResult = {
  rows?: readonly Record<string, unknown>[];
};

export type SqlQueryExecutor = {
  query(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult | unknown>;
};

export type SqlLifecycleStoreOptions = {
  now?: () => Date;
  id?: () => string;
};

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

const enabledReleaseRepositories = new Set(["oaslananka/boardreadyops", "oaslananka/zaptrace"]);

function releaseRepositoryEnabled(fullName: string | undefined): boolean {
  return Boolean(fullName && enabledReleaseRepositories.has(fullName.toLowerCase()));
}

export function createSqlGitHubAppLifecycleStore(
  executor: SqlQueryExecutor,
  options: SqlLifecycleStoreOptions = {},
): GitHubAppLifecycleStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;

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

      if (!releaseRepositoryEnabled(action.repository.fullName)) {
        return { idempotencyKey };
      }

      const result = await executor.query(
        `insert into release_runs (id, repository_id, idempotency_key, commit_sha, ref, pull_request_number, trigger_kind, status, started_at)
         select $8, repositories.id, $9, $2, $3, $4, $5, 'queued', $6
         from repositories
         join installations on installations.id = repositories.installation_id
         where repositories.github_repo_id = $1
           and installations.github_installation_id = $7
         on conflict (idempotency_key)
         do update set status = release_runs.status
         returning id, github_check_run_id`,
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
      };
      const runId = stringColumn(row, "id");
      const githubCheckRunId = checkRunColumn(row);

      if (runId) {
        enqueued.runId = runId;
      }

      if (githubCheckRunId !== undefined) {
        enqueued.githubCheckRunId = githubCheckRunId;
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

    async markReleaseRunDispatched(input) {
      await executor.query(
        `update release_runs
         set status = 'dispatched', decision = coalesce($2, decision)
         where id = $1
           and status = 'queued'`,
        [input.runId, input.workflowDispatchId],
      );
    },
  };
}
