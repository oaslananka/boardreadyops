import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { remoteMcpResource } from "./remote-mcp-foundation.js";

/** Access token signature/issuer/audience are validated before looking up this record.
 * This is a secondary, durable revocation and identity binding check on every call.
 */
export async function isRemoteMcpGrantActive(
  executor: Pick<PgQueryExecutor, "query">,
  grantId: string,
  githubUserId: number,
  clientId: string,
  issuer: string,
  scope: string,
): Promise<boolean> {
  if (
    typeof grantId !== "string" ||
    grantId.length < 16 ||
    grantId.length > 128 ||
    !Number.isSafeInteger(githubUserId) ||
    githubUserId <= 0 ||
    !["review:read", "evidence:read", "review:read evidence:read", "evidence:read review:read"].includes(scope)
  )
    return false;
  try {
    const result = await executor.query(
      `select 1 from remote_mcp_oauth_grants g
       join remote_mcp_oauth_clients c on c.client_id = g.client_id
       where g.jti = $1 and g.github_user_id = $2
         and g.revoked_at is null and g.expires_at > now()
         and g.audience = $3 and g.client_id = $4 and g.issuer = $5
         and g.scope = $6 and c.enabled = true
         and g.client_registration_epoch = c.registration_epoch
       limit 1`,
      [grantId, githubUserId, remoteMcpResource, clientId, issuer, scope],
    );
    return ((result as { rows?: unknown[] }).rows ?? []).length === 1;
  } catch {
    return false;
  }
}

/** Only the grant owner may revoke their grant; no caller-supplied user identity is trusted. */
export async function revokeRemoteMcpGrant(
  executor: Pick<PgQueryExecutor, "query">,
  grantId: string,
  authenticatedGithubUserId: number,
): Promise<boolean> {
  if (
    typeof grantId !== "string" ||
    grantId.length < 16 ||
    grantId.length > 128 ||
    !Number.isSafeInteger(authenticatedGithubUserId) ||
    authenticatedGithubUserId <= 0
  )
    return false;
  const result = await executor.query(
    `with revoked as (
       update remote_mcp_oauth_grants set revoked_at = now()
       where jti = $1 and github_user_id = $2 and revoked_at is null
       returning jti, github_user_id
     ), logged as (
       insert into remote_mcp_oauth_security_events(event_kind, github_user_id, grant_id)
       select 'grant_revoked', github_user_id, jti from revoked returning id
     )
     select revoked.jti from revoked join logged on true`,
    [grantId, authenticatedGithubUserId],
  );
  return ((result as { rows?: unknown[] }).rows ?? []).length === 1;
}
