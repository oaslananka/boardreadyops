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

export type RemoteMcpOAuthCleanupCounts = {
  rateLimitBucketsPurged: number;
  securityEventsPurged: number;
  loginResumptionsPurged: number;
  expiredGrantsPurged: number;
  expiredAuthorizationsPurged: number;
};

/** Hourly, bounded retention cleanup, safe for concurrent worker replicas.
 * Expired rate buckets are retained for 2 days, redacted audit for 90 days.
 * Expired grants are retained for 2 days, expired codes/consents for 1 day.
 * Real, current grants and consent/code lifetimes are never shortened.
 * In a deployment that has not yet applied OAuth migrations, do nothing;
 * if only one required table exists, report the partial migration as failure.
 * Existing live and recently expired rate buckets are never deleted.
 */
export async function purgeExpiredRemoteMcpOAuthSecurityData(
  db: Pick<PgQueryExecutor, "query">,
  limit = 1000,
): Promise<RemoteMcpOAuthCleanupCounts> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Invalid MCP OAuth retention batch size");
  }
  const presence = await db.query(
    `select to_regclass('public.remote_mcp_oauth_rate_limits') is not null as has_buckets,
            to_regclass('public.remote_mcp_oauth_security_events') is not null as has_events,
            to_regclass('public.remote_mcp_oauth_login_resumptions') is not null as has_resumptions,
            to_regclass('public.remote_mcp_oauth_authorizations') is not null as has_authorizations,
            to_regclass('public.remote_mcp_oauth_grants') is not null as has_grants`,
  );
  const tables = ((
    presence as {
      rows?: {
        has_buckets: boolean;
        has_events: boolean;
        has_resumptions?: boolean;
        has_authorizations?: boolean;
        has_grants?: boolean;
      }[];
    }
  ).rows ?? [])[0];
  if (!tables) throw new Error("OAuth retention schema check unavailable");
  if (!tables.has_buckets && !tables.has_events) {
    return {
      rateLimitBucketsPurged: 0,
      securityEventsPurged: 0,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    };
  }
  if (!tables.has_buckets || !tables.has_events || !tables.has_authorizations || !tables.has_grants)
    throw new Error("Incomplete MCP OAuth retention migration");

  const buckets = await db.query(
    `with expired as (
       select ctid from remote_mcp_oauth_rate_limits
       where window_started_at < now() - interval '2 days'
       order by window_started_at limit $1 for update skip locked
     ), deleted as (
       delete from remote_mcp_oauth_rate_limits where ctid in (select ctid from expired)
       returning 1
     ) select count(*)::int as n from deleted`,
    [limit],
  );
  const events = await db.query(
    `with expired as (
       select ctid from remote_mcp_oauth_security_events
       where recorded_at < now() - interval '90 days'
       order by recorded_at limit $1 for update skip locked
     ), deleted as (
       delete from remote_mcp_oauth_security_events where ctid in (select ctid from expired)
       returning 1
     ) select count(*)::int as n from deleted`,
    [limit],
  );
  const resumes = tables.has_resumptions
    ? await db.query(
        `with expired as (
           select ctid from remote_mcp_oauth_login_resumptions
           where expires_at < now()
           order by expires_at limit $1 for update skip locked
         ), deleted as (
           delete from remote_mcp_oauth_login_resumptions where ctid in (select ctid from expired)
           returning 1
         ) select count(*)::int as n from deleted`,
        [limit],
      )
    : null;
  const grants = await db.query(
    `with expired as (
       select ctid from remote_mcp_oauth_grants
       where expires_at < now() - interval '2 days'
       order by expires_at limit $1 for update skip locked
     ), deleted as (
       delete from remote_mcp_oauth_grants where ctid in (select ctid from expired)
       returning 1
     ) select count(*)::int as n from deleted`,
    [limit],
  );
  const authorizations = await db.query(
    `with expired as (
       select ctid from remote_mcp_oauth_authorizations
       where expires_at < now() - interval '1 day'
       order by expires_at limit $1 for update skip locked
     ), deleted as (
       delete from remote_mcp_oauth_authorizations where ctid in (select ctid from expired)
       returning 1
     ) select count(*)::int as n from deleted`,
    [limit],
  );
  const grantCount = Number(((grants as { rows?: { n: number }[] }).rows ?? [])[0]?.n);
  const authorizationCount = Number(((authorizations as { rows?: { n: number }[] }).rows ?? [])[0]?.n);
  const resumeCount = resumes ? Number(((resumes as { rows?: { n: number }[] }).rows ?? [])[0]?.n) : 0;
  const bucketCount = Number(((buckets as { rows?: { n: number }[] }).rows ?? [])[0]?.n);
  const eventCount = Number(((events as { rows?: { n: number }[] }).rows ?? [])[0]?.n);
  if (
    !Number.isSafeInteger(bucketCount) ||
    bucketCount < 0 ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 0 ||
    !Number.isSafeInteger(resumeCount) ||
    resumeCount < 0 ||
    !Number.isSafeInteger(grantCount) ||
    grantCount < 0 ||
    !Number.isSafeInteger(authorizationCount) ||
    authorizationCount < 0
  ) {
    throw new Error("Invalid MCP OAuth retention result");
  }
  return {
    rateLimitBucketsPurged: bucketCount,
    securityEventsPurged: eventCount,
    loginResumptionsPurged: resumeCount,
    expiredGrantsPurged: grantCount,
    expiredAuthorizationsPurged: authorizationCount,
  };
}
