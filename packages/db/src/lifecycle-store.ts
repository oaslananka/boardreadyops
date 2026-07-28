import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { GitHubAppLifecycleAction } from "@boardreadyops/cloud-core/lifecycle";

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

export type GitHubAppMetadataStore = {
  upsertInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.upsert" }>): Promise<void>;
  deleteInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.deleted" }>): Promise<void>;
  upsertRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.upsert" }>): Promise<void>;
  removeRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.removed" }>): Promise<void>;
};

export const releaseRepositoryRolloutEnvName = "BOARDREADYOPS_RELEASE_REPOSITORIES";
export const releaseRepositoryRolloutFileEnvName = "BOARDREADYOPS_RELEASE_REPOSITORIES_FILE";

const maximumReleaseRepositoryRolloutFileBytes = 64 * 1024;

type Environment = Record<string, string | undefined>;

function iso(now: () => Date): string {
  return now().toISOString();
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

function releaseRepositoryRolloutFile(path: string): string | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > maximumReleaseRepositoryRolloutFileBytes) {
      return undefined;
    }
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function releaseRepositoryRolloutPolicyFromEnvironment(env: Environment): ReleaseRepositoryRolloutPolicy {
  const configuredFile = env[releaseRepositoryRolloutFileEnvName]?.trim();
  if (configuredFile) {
    return parseReleaseRepositoryRolloutPolicy(releaseRepositoryRolloutFile(configuredFile));
  }
  return parseReleaseRepositoryRolloutPolicy(env[releaseRepositoryRolloutEnvName]);
}

export function createSqlGitHubAppMetadataStore(
  executor: SqlQueryExecutor,
  options: SqlLifecycleStoreOptions = {},
): GitHubAppMetadataStore {
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
  };
}
