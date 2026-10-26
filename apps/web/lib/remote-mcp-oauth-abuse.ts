import { createHash } from "node:crypto";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";

export type OAuthAuditKind =
  | "consent_started"
  | "consent_approved"
  | "consent_denied"
  | "token_issued"
  | "token_rejected"
  | "rate_limited"
  | "grant_revoked";

export const oauthClientDigest = (clientId: string): string =>
  createHash("sha256").update(clientId, "utf8").digest("hex");

/** PostgreSQL upsert is atomic across server replicas and concurrent requests.
 * No request-provided IP/X-Forwarded-For header is trusted for the key.
 * A DB error must propagate to the caller, which must deny the request.
 */
export async function takeRemoteMcpOAuthRateLimit(
  db: Pick<PgQueryExecutor, "query">,
  category: "token-global" | "token-client" | "consent-user" | "consent-decision-user",
  key: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (
    !/^[a-z0-9-]{1,30}$/u.test(category) ||
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 2048 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  ) {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  const digest = oauthClientDigest(`${category}:${key}`);
  const result = await db.query(
    `insert into remote_mcp_oauth_rate_limits as throttle
       (bucket_sha256, window_started_at, attempts)
       values ($1, date_trunc('minute', clock_timestamp()), 1)
     on conflict (bucket_sha256) do update
       set attempts = case
           when throttle.window_started_at < date_trunc('minute', clock_timestamp()) then 1
           else throttle.attempts + 1 end,
           window_started_at = case
           when throttle.window_started_at < date_trunc('minute', clock_timestamp())
             then date_trunc('minute', clock_timestamp())
           else throttle.window_started_at end
     returning attempts, greatest(1, extract(epoch from
       (window_started_at + interval '1 minute' - clock_timestamp())))::int as retry_after`,
    [digest],
  );
  const row = ((result as { rows?: { attempts: number; retry_after: number }[] }).rows ?? [])[0];
  if (!row || !Number.isSafeInteger(row.attempts) || !Number.isSafeInteger(row.retry_after)) {
    throw new Error("OAuth limiter store unavailable");
  }
  return { allowed: row.attempts <= limit, retryAfterSeconds: row.retry_after };
}

/** Audit records contain no plaintext client URL, bearer token or source IP. */
export async function recordRemoteMcpOAuthEvent(
  db: Pick<PgQueryExecutor, "query">,
  kind: OAuthAuditKind,
  githubUserId?: number,
  clientId?: string,
  grantId?: string,
): Promise<void> {
  if (githubUserId !== undefined && (!Number.isSafeInteger(githubUserId) || githubUserId <= 0)) {
    throw new Error("Invalid audit principal");
  }
  await db.query(
    `insert into remote_mcp_oauth_security_events
     (event_kind, github_user_id, client_sha256, grant_id) values ($1, $2, $3, $4)`,
    [kind, githubUserId ?? null, clientId ? oauthClientDigest(clientId) : null, grantId ?? null],
  );
}

/** Intended for periodic scheduled maintenance; do not delete active buckets. */
export async function purgeExpiredRemoteMcpOAuthSecurityData(db: Pick<PgQueryExecutor, "query">) {
  await db.query("delete from remote_mcp_oauth_rate_limits where window_started_at < now() - interval '2 days'");
  await db.query("delete from remote_mcp_oauth_security_events where recorded_at < now() - interval '90 days'");
}
