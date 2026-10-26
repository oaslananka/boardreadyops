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
    const migration = await readFile(
      new URL("../../packages/db/migrations/0097_remote_mcp_oauth_abuse_controls.sql", import.meta.url),
      "utf8",
    );
    await executor().query(migration);
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
    expect(result).toEqual({ rateLimitBucketsPurged: 1, securityEventsPurged: 1 });
    const remainingOldRate = await executor().query(
      "select count(*)::int as n from remote_mcp_oauth_rate_limits where bucket_sha256 = any($1::text[])",
      [oldBuckets],
    );
    expect((remainingOldRate as { rows: { n: number }[] }).rows[0]?.n).toBe(2);
  });

  it("eventually clears only expired data while preserving recent rate and audit records", async () => {
    const remaining = await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10);
    expect(remaining).toEqual({ rateLimitBucketsPurged: 2, securityEventsPurged: 2 });
    expect(await purgeExpiredRemoteMcpOAuthSecurityData(executor(), 10)).toEqual({
      rateLimitBucketsPurged: 0,
      securityEventsPurged: 0,
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
});
