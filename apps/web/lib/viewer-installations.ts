import type { UserSession } from "./user-session.js";

/**
 * The installations a signed-in viewer may act on, with the details a settings page needs.
 *
 * The session records GitHub's installation ids because that is what the OAuth flow returns.
 * Everything server-side is keyed by the internal id, so the mapping happens here rather than
 * in a page, and the query is driven by the session rather than by anything in the request.
 */

export type ViewerInstallation = {
  /** Internal id; the key for every store in the control plane. */
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  planTier: string;
  /** Whether a component-intelligence credential is stored, never the credential itself. */
  hasComponentCredential: boolean;
  componentCredentialRejectedAt: string | undefined;
  componentCredentialRejectedReason: string | undefined;
};

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

/**
 * Lists the viewer's installations.
 *
 * Returns an empty list rather than throwing when the session is absent or carries no
 * installations: a signed-out visitor sees nothing to configure, which is the correct answer
 * rather than an error.
 */
export async function viewerInstallations(
  session: UserSession | undefined,
  provider: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ViewerInstallation[]> {
  if (!session || session.installationIds.length === 0) return [];
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return [];

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(
      `select installations.id,
              installations.github_installation_id,
              installations.account_login,
              installations.plan_tier,
              credential.credential_envelope is not null as has_credential,
              credential.last_rejected_at,
              credential.last_rejected_reason
         from installations
         left join installation_component_credentials as credential
           on credential.installation_id = installations.id
          and credential.provider = $2
        where installations.github_installation_id = any($1::bigint[])
          -- A suspended installation cannot run anything, so offering to configure it would
          -- promise work that will not happen.
          and installations.suspended_at is null
          and not exists (
            select 1
              from github_marketplace_subscriptions
             where github_marketplace_subscriptions.status = 'canceled'
               and (
                 github_marketplace_subscriptions.github_installation_id = installations.github_installation_id
                 or (
                   github_marketplace_subscriptions.github_installation_id is null
                   and lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)
                 )
               )
          )
        order by installations.account_login, installations.id`,
      [session.installationIds, provider],
    );
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];

    return rows.flatMap((row): ViewerInstallation[] => {
      const id = text(row, "id");
      // node-postgres decodes bigint as a string to avoid precision loss.
      const raw = row.github_installation_id;
      const githubInstallationId = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
      if (!id || !Number.isSafeInteger(githubInstallationId)) return [];
      return [
        {
          id,
          githubInstallationId,
          accountLogin: text(row, "account_login") || String(githubInstallationId),
          planTier: text(row, "plan_tier") ?? "free",
          hasComponentCredential: row.has_credential === true,
          componentCredentialRejectedAt: text(row, "last_rejected_at"),
          componentCredentialRejectedReason: text(row, "last_rejected_reason"),
        },
      ];
    });
  } finally {
    await executor.close();
  }
}
