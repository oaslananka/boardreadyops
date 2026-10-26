import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpiredRemoteMcpOAuthSecurityData } from "../../apps/web/lib/remote-mcp-oauth-abuse.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const databaseUrl = getPostgresTestConnectionString();
const describePg = databaseUrl ? describe : describe.skip;
const db = databaseUrl ? createPgQueryExecutor({ connectionString: databaseUrl, max: 2 }) : undefined;
const marker = randomUUID();
const digest = (value: string) => createHash("sha256").update(`${marker}:${value}`).digest("hex");
const oldBuckets = [digest("old1"), digest("old2"), digest("old3")];
const recentBucket = digest("recent");
const oldEvents = [digest("oldEvent1"), digest("oldEvent2"), digest("oldEvent3")];
const recentEvent = digest("recentEvent");
function executor() {
  if (!db) throw new Error("A disposable PostgreSQL database is required");
  return db;
}

describePg("bounded remote MCP OAuth worker cleanup on PostgreSQL", () => {
  beforeAll(async () => {
    for (const name of [
      "0095_remote_mcp_oauth_grants.sql",
      "0096_remote_mcp_oauth_authorization_codes.sql",
      "0097_remote_mcp_oauth_abuse_controls.sql",
      "0098_remote_mcp_oauth_login_resumptions.sql",
      "0099_remote_mcp_oauth_retention_indexes.sql",
    ]) {
      const migration = await readFile(new URL(`../../packages/db/migrations/${name}`, import.meta.url), "utf8");
      await executor().query(migration);
    }
    for (const bucket of oldBuckets) {
      await executor().query(
        "insert into remote_mcp_oauth_rate_limits(bucket_sha256, window_started_at, attempts) values($1, now() - interval '4 days', 3)",
        [bucket],
      );
    }
    await executor().query(
      "insert into remote_mcp_oauth_rate_limits(bucket_sha256, window_started_at, attempts) values($1, now() - interval '2 minutes', 2)",
      [recentBucket],
    );
    for (const event of oldEvents) {
      await executor().query(
        "insert into remote_mcp_oauth_security_events(event_kind, client_sha256, recorded_at) values ('rate_limited', $1, now() - interval '95 days')",
        [event],
      );
    }
    await executor().query(
      "insert into remote_mcp_oauth_security_events(event_kind, client_sha256, recorded_at) values ('token_issued', $1, now() - interval '1 day')",
      [recentEvent],
    );
  });

  afterAll(async () => {
    try {
      await executor().query("delete from remote_mcp_oauth_rate_limits where bucket_sha256 = any($1::text[])", [
        [...oldBuckets, recentBucket],
      ]);
      await executor().query("delete from remote_mcp_oauth_security_events where client_sha256 = any($1::text[])", [
        [...oldEvents, recentEvent],
      ]);
    } finally {
      await db?.close();
    }
  });

  it("rejects unbounded or malformed cleanup requests", async () => {
    await expect(purgeExpiredRemoteMcpOAuthSecurityData(executor(), 0)).rejects.toThrow(RangeError);
    await expect(purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10001)).rejects.toThrow(RangeError);
  });

  it("deletes at most one stale rate bucket and one stale audit record per pass", async () => {
    const result = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 1);
    expect(result).toEqual({
      rateLimitBucketsPurged: 1,
      securityEventsPurged: 1,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    });
    const remainingOldRate = await executor().query(
      "select count(*)::int as n from remote_mcp_oauth_rate_limits where bucket_sha256 = any($1::text[])",
      [oldBuckets],
    );
    expect((remainingOldRate as { rows: { n: number }[] }).rows[0]?.n).toBe(2);
  });

  it("eventually clears only expired data while preserving recent rate and audit records", async () => {
    const remaining = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
    expect(remaining).toEqual({
      rateLimitBucketsPurged: 2,
      securityEventsPurged: 2,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    });
    expect(await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10)).toEqual({
      rateLimitBucketsPurged: 0,
      securityEventsPurged: 0,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    });
    const activeRate = await executor().query(
      "select attempts from remote_mcp_oauth_rate_limits where bucket_sha256 = $1",
      [recentBucket],
    );
    expect((activeRate as { rows: { attempts: number }[] }).rows[0]?.attempts).toBe(2);
    const activeEvent = await executor().query(
      "select event_kind from remote_mcp_oauth_security_events where client_sha256 = $1",
      [recentEvent],
    );
    expect((activeEvent as { rows: { event_kind: string }[] }).rows[0]?.event_kind).toBe("token_issued");
  });
  it("expires browser-bound login resumptions in bounded batches, preserving live requests", async () => {
    const client = `https://oauth-retention.example/${marker}`;
    await executor().query(
      `insert into remote_mcp_oauth_clients(client_id, redirect_uri, display_name, enabled)
       values ($1, 'https://oauth-retention.example/callback', 'Retention Test', true)`,
      [client],
    );
    const oldIds = [randomUUID(), randomUUID(), randomUUID()];
    const currentId = randomUUID();
    try {
      for (const id of oldIds) {
        await executor().query(
          `insert into remote_mcp_oauth_login_resumptions
            (id, nonce_sha256, client_id, request_parameters, created_at, expires_at)
           values($1::uuid, $2, $3, '{}'::jsonb, now() - interval '12 minutes', now() - interval '3 minutes')`,
          [id, digest(id), client],
        );
      }
      await executor().query(
        `insert into remote_mcp_oauth_login_resumptions
          (id, nonce_sha256, client_id, request_parameters, expires_at)
         values ($1::uuid, $2, $3, '{}'::jsonb, now() + interval '9 minutes')`,
        [currentId, digest(currentId), client],
      );
      const first = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 1);
      expect(first.loginResumptionsPurged).toBe(1);
      const second = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
      expect(second.loginResumptionsPurged).toBe(2);
      const third = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
      expect(third.loginResumptionsPurged).toBe(0);
      const active = await executor().query("select id from remote_mcp_oauth_login_resumptions where id = $1::uuid", [
        currentId,
      ]);
      expect((active as { rows: unknown[] }).rows).toHaveLength(1);
    } finally {
      await executor().query("delete from remote_mcp_oauth_login_resumptions where client_id = $1", [client]);
      await executor().query("delete from remote_mcp_oauth_clients where client_id = $1", [client]);
    }
  });
  it("removes only long-expired OAuth grants and one-use consent codes in bounded worker batches", async () => {
    const clientId = `mcp-retention-test-${randomUUID()}`;
    const pastGrants = [randomUUID(), randomUUID(), randomUUID()];
    const liveGrant = randomUUID();
    const pastCodes = [randomUUID(), randomUUID(), randomUUID()];
    const liveCode = randomUUID();
    await executor().query(
      `insert into remote_mcp_oauth_clients (client_id, redirect_uri, display_name, enabled)
       values ($1, 'https://example.org/oauth-return', 'Grant Retention Test', true)`,
      [clientId],
    );
    try {
      for (const id of pastGrants) {
        await executor().query(
          `insert into remote_mcp_oauth_grants
            (jti, github_user_id, client_id, issuer, scope, created_at, expires_at)
           values ($1, 123, $2, 'https://boardreadyops.com', 'review:read',
                   now() - interval '4 days', now() - interval '4 days' + interval '15 minutes')`,
          [id, clientId],
        );
      }
      await executor().query(
        `insert into remote_mcp_oauth_grants
          (jti, github_user_id, client_id, issuer, scope, expires_at)
         values ($1, 123, $2, 'https://boardreadyops.com', 'review:read', now() + interval '15 minutes')`,
        [liveGrant, clientId],
      );
      for (const id of pastCodes) {
        await executor().query(
          `insert into remote_mcp_oauth_authorizations
            (id, github_user_id, client_id, redirect_uri, scope, state,
             code_challenge, csrf_sha256, created_at, expires_at)
           values ($1, 123, $2, 'https://example.org/oauth-return', 'review:read',
                   'safe-state-123', $3, $4,
                   now() - interval '3 days', now() - interval '3 days' + interval '10 minutes')`,
          [id, clientId, "A".repeat(43), digest(id)],
        );
      }
      await executor().query(
        `insert into remote_mcp_oauth_authorizations
          (id, github_user_id, client_id, redirect_uri, scope, state,
           code_challenge, csrf_sha256, expires_at)
         values ($1, 123, $2, 'https://example.org/oauth-return', 'review:read',
                 'safe-state-123', $3, $4, now() + interval '10 minutes')`,
        [liveCode, clientId, "A".repeat(43), digest(liveCode)],
      );
      const first = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 1);
      expect(first.expiredGrantsPurged).toBe(1);
      expect(first.expiredAuthorizationsPurged).toBe(1);
      const rest = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
      expect(rest.expiredGrantsPurged).toBe(2);
      expect(rest.expiredAuthorizationsPurged).toBe(2);
      const empty = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
      expect(empty.expiredGrantsPurged).toBe(0);
      expect(empty.expiredAuthorizationsPurged).toBe(0);
      const liveGrants = await executor().query("select jti from remote_mcp_oauth_grants where client_id = $1", [
        clientId,
      ]);
      const liveAuthorizations = await executor().query(
        "select id from remote_mcp_oauth_authorizations where client_id = $1",
        [clientId],
      );
      expect((liveGrants as { rows: { jti: string }[] }).rows.map((row) => row.jti)).toEqual([liveGrant]);
      expect((liveAuthorizations as { rows: { id: string }[] }).rows.map((row) => row.id)).toEqual([liveCode]);
    } finally {
      await executor().query("delete from remote_mcp_oauth_authorizations where client_id = $1", [clientId]);
      await executor().query("delete from remote_mcp_oauth_grants where client_id = $1", [clientId]);
      await executor().query("delete from remote_mcp_oauth_clients where client_id = $1", [clientId]);
    }
  });
});
