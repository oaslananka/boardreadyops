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
): Promise<boolean> {
  if (
    typeof grantId !== "string" ||
    grantId.length < 16 ||
    grantId.length > 128 ||
    !Number.isSafeInteger(githubUserId) ||
    githubUserId <= 0
  )
    return false;
  try {
    const result = await executor.query(
      `select 1 from remote_mcp_oauth_grants
       where jti = $1 and github_user_id = $2
         and revoked_at is null and expires_at > now()
         and audience = $3
         and client_id = $4 and issuer = $5
       limit 1`,
      [grantId, githubUserId, remoteMcpResource, clientId, issuer],
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
    `update remote_mcp_oauth_grants set revoked_at = now()
     where jti = $1 and github_user_id = $2 and revoked_at is null
     returning jti`,
    [grantId, authenticatedGithubUserId],
  );
  return ((result as { rows?: unknown[] }).rows ?? []).length === 1;
}
