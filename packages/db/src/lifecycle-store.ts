import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "@boardreadyops/cloud-core/lifecycle";
import type { GitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";

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

export type GitHubAppMetadataStore = Pick<
  GitHubAppLifecycleStore,
  | "upsertInstallation"
  | "deleteInstallation"
  | "suspendInstallation"
  | "unsuspendInstallation"
  | "upsertRepository"
  | "removeRepository"
>;

export const releaseRepositoryRolloutEnvName = "BOARDREADYOPS_RELEASE_REPOSITORIES";
export const releaseRepositoryRolloutFileEnvName = "BOARDREADYOPS_RELEASE_REPOSITORIES_FILE";

const maximumReleaseRepositoryRolloutFileBytes = 64 * 1024;

type Environment = Record<string, string | undefined>;

function iso(now: () => Date): string {
  return now().toISOString();
}

export type GitHubLifecycleAuditEvent = {
  id: string;
  eventType: string;
  requestId: string;
  subjectType: "installation" | "repository";
  metadata: Readonly<Record<string, boolean | number | string>>;
};

function deterministicAuditEventId(parts: readonly (number | string)[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function installationAuditEventType(
  action: Extract<
    GitHubAppLifecycleAction,
    {
      type: "installation.upsert" | "installation.deleted" | "installation.suspended" | "installation.unsuspended";
    }
  >,
  context: GitHubAppLifecycleContext,
): string | undefined {
  if (context.eventType !== "installation") return undefined;
  if (action.type === "installation.upsert" && context.eventAction === "created") {
    return "github_app.installation.enabled";
  }
  if (action.type === "installation.deleted" && context.eventAction === "deleted") {
    return "github_app.installation.disabled";
  }
  if (action.type === "installation.suspended" && context.eventAction === "suspend") {
    return "github_app.installation.suspended";
  }
  if (action.type === "installation.unsuspended" && context.eventAction === "unsuspend") {
    return "github_app.installation.unsuspended";
  }
  return undefined;
}

function repositoryAuditEventType(
  action: Extract<GitHubAppLifecycleAction, { type: "repository.upsert" | "repository.removed" }>,
  context: GitHubAppLifecycleContext,
): string | undefined {
  const enabled =
    action.type === "repository.upsert" &&
    ((context.eventType === "installation" && context.eventAction === "created") ||
      (context.eventType === "installation_repositories" && context.eventAction === "added"));
  if (enabled) return "github_app.repository.enabled";

  const disabled =
    action.type === "repository.removed" &&
    ((context.eventType === "installation" && context.eventAction === "deleted") ||
      (context.eventType === "installation_repositories" && context.eventAction === "removed"));
  return disabled ? "github_app.repository.disabled" : undefined;
}

export function lifecycleAuditEventForAction(
  action: GitHubAppLifecycleAction,
  context: GitHubAppLifecycleContext | undefined,
): GitHubLifecycleAuditEvent | undefined {
  if (!context || action.type === "release_run.enqueue") return undefined;

  if (
    action.type === "installation.upsert" ||
    action.type === "installation.deleted" ||
    action.type === "installation.suspended" ||
    action.type === "installation.unsuspended"
  ) {
    const eventType = installationAuditEventType(action, context);
    if (!eventType) return undefined;
    return {
      id: deterministicAuditEventId([context.deliveryId, eventType, action.installation.id]),
      eventType,
      requestId: context.deliveryId,
      subjectType: "installation",
      metadata: {
        action: context.eventAction ?? "unknown",
        githubInstallationId: action.installation.id,
      },
    };
  }

  const eventType = repositoryAuditEventType(action, context);
  if (!eventType) return undefined;
  return {
    id: deterministicAuditEventId([context.deliveryId, eventType, action.repository.id]),
    eventType,
    requestId: context.deliveryId,
    subjectType: "repository",
    metadata: {
      action: context.eventAction ?? "unknown",
      githubRepositoryId: action.repository.id,
      repositoryPrivate: action.repository.private,
    },
  };
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
  const auditParameters = (audit: GitHubLifecycleAuditEvent | undefined) =>
    [
      audit?.id ?? null,
      audit?.eventType ?? null,
      audit?.subjectType ?? null,
      audit?.requestId ?? null,
      JSON.stringify(audit?.metadata ?? {}),
    ] as const;
  const persistInstallationSuspensionTransition = async (
    action: Extract<GitHubAppLifecycleAction, { type: "installation.suspended" | "installation.unsuspended" }>,
    context: GitHubAppLifecycleContext | undefined,
    suspended: boolean,
  ) => {
    const at = iso(now);
    const audit = lifecycleAuditEventForAction(action, context);
    await executor.query(
      `with persisted as (
         update installations
         set suspended_at = $2::timestamptz
         where github_installation_id = $1
           and (
             $4::text is null
             or not exists (select 1 from audit_events where id = $4::text)
           )
           and (
             ($2::timestamptz is null and suspended_at is not null)
             or ($2::timestamptz is not null and suspended_at is null)
           )
         returning id
       ), audited as (
         insert into audit_events (
           id, installation_id, event_type, actor_type, subject_type, subject_id,
           request_id, metadata, created_at
         )
         select $4, persisted.id, $5, 'github_webhook', $6, persisted.id, $7, $8::jsonb, $3
         from persisted
         where $4::text is not null
         on conflict (id) do nothing
       )
       select id from persisted`,
      [action.installation.id, suspended ? at : null, at, ...auditParameters(audit)],
    );
  };

  return {
    async upsertInstallation(action, context) {
      const at = iso(now);
      const audit = lifecycleAuditEventForAction(action, context);
      await executor.query(
        `with persisted as (
           insert into installations (id, github_installation_id, account_login, account_type, created_at, suspended_at)
           values ($1, $2, $3, $4, $5, null)
           on conflict (github_installation_id)
           do update set
             account_login = excluded.account_login,
             account_type = excluded.account_type,
             suspended_at = case
               when $6::text is not null
                 and not exists (select 1 from audit_events where id = $6::text)
               then null
               else installations.suspended_at
             end
           returning id
         ), audited as (
           insert into audit_events (
             id, installation_id, event_type, actor_type, subject_type, subject_id,
             request_id, metadata, created_at
           )
           select $6, persisted.id, $7, 'github_webhook', $8, persisted.id, $9, $10::jsonb, $5
           from persisted
           where $6::text is not null
           on conflict (id) do nothing
         )
         select id from persisted`,
        [
          id(),
          action.installation.id,
          action.installation.accountLogin ?? "",
          action.installation.accountType ?? "",
          at,
          ...auditParameters(audit),
        ],
      );
    },

    async deleteInstallation(action, context) {
      const at = iso(now);
      const audit = lifecycleAuditEventForAction(action, context);
      await executor.query(
        `with persisted as (
           update installations
           set suspended_at = $2
           where github_installation_id = $1
             and (
               $3::text is null
               or not exists (select 1 from audit_events where id = $3::text)
             )
           returning id
         ), audited as (
           insert into audit_events (
             id, installation_id, event_type, actor_type, subject_type, subject_id,
             request_id, metadata, created_at
           )
           select $3, persisted.id, $4, 'github_webhook', $5, persisted.id, $6, $7::jsonb, $2
           from persisted
           where $3::text is not null
           on conflict (id) do nothing
         )
         select id from persisted`,
        [action.installation.id, at, ...auditParameters(audit)],
      );
    },

    async suspendInstallation(action, context) {
      await persistInstallationSuspensionTransition(action, context, true);
    },

    async unsuspendInstallation(action, context) {
      await persistInstallationSuspensionTransition(action, context, false);
    },

    async upsertRepository(action, context) {
      const at = iso(now);
      const audit = lifecycleAuditEventForAction(action, context);
      await executor.query(
        `with persisted as (
           insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch, enabled_at, disabled_at)
           select $8, id, $2, $3, $4, $5, $6, $7, null
           from installations
           where github_installation_id = $1
           on conflict (github_repo_id)
           do update set
             installation_id = excluded.installation_id,
             owner = excluded.owner,
             name = excluded.name,
             private = excluded.private,
             default_branch = excluded.default_branch,
             disabled_at = case
               when $9::text is not null
                 and not exists (select 1 from audit_events where id = $9::text)
               then null
               else repositories.disabled_at
             end
           returning id, installation_id
         ), audited as (
           insert into audit_events (
             id, installation_id, event_type, actor_type, subject_type, subject_id,
             repository_id, request_id, metadata, created_at
           )
           select $9, persisted.installation_id, $10, 'github_webhook', $11, persisted.id,
                  persisted.id, $12, $13::jsonb, $7
           from persisted
           where $9::text is not null
           on conflict (id) do nothing
         )
         select id from persisted`,
        [
          action.installation.id,
          action.repository.id,
          action.repository.owner,
          action.repository.name,
          action.repository.private,
          action.repository.defaultBranch ?? "main",
          at,
          id(),
          ...auditParameters(audit),
        ],
      );
    },

    async removeRepository(action, context) {
      const at = iso(now);
      const audit = lifecycleAuditEventForAction(action, context);
      await executor.query(
        `with persisted as (
           update repositories
           set disabled_at = $3
           where github_repo_id = $1
             and (
               $4::text is null
               or not exists (select 1 from audit_events where id = $4::text)
             )
             and exists (
               select 1 from installations
               where installations.id = repositories.installation_id
                 and installations.github_installation_id = $2
             )
           returning id, installation_id
         ), audited as (
           insert into audit_events (
             id, installation_id, event_type, actor_type, subject_type, subject_id,
             repository_id, request_id, metadata, created_at
           )
           select $4, persisted.installation_id, $5, 'github_webhook', $6, persisted.id,
                  persisted.id, $7, $8::jsonb, $3
           from persisted
           where $4::text is not null
           on conflict (id) do nothing
         )
         select id from persisted`,
        [action.repository.id, action.installation.id, at, ...auditParameters(audit)],
      );
    },
  };
}
