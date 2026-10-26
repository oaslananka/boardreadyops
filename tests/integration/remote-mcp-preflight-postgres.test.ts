import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectRemoteMcpReleasePrerequisites } from "../../packages/db/scripts/remote-mcp-release-preflight.mjs";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const url = getPostgresTestConnectionString();
const describePg = url ? describe : describe.skip;
const db = url ? createPgQueryExecutor({ connectionString: url, max: 2 }) : undefined;
const testClient = `opaque-preflight-${randomUUID()}`;
const query = (sql: string, params?: readonly unknown[]) => {
  if (!db) throw new Error("An isolated PostgreSQL test database is required");
  return db.query(sql, params);
};
const status = (report: { checks: { id: string; status: string }[] }, id: string) =>
  report.checks.find((check) => check.id === id)?.status;

describePg("release preflight against real read-only OAuth database state", () => {
  beforeAll(async () => {
    for (const filename of [
      "0095_remote_mcp_oauth_grants.sql",
      "0096_remote_mcp_oauth_authorization_codes.sql",
      "0097_remote_mcp_oauth_abuse_controls.sql",
      "0098_remote_mcp_oauth_login_resumptions.sql",
      "0099_remote_mcp_oauth_retention_indexes.sql",
    ]) {
      const sql = await readFile(new URL(`../../packages/db/migrations/${filename}`, import.meta.url), "utf8");
      await query(sql);
    }
    await query(
      `insert into remote_mcp_oauth_clients (client_id, redirect_uri, display_name, enabled)
       values ($1, $2, 'Unpublished Preflight Test', false)`,
      [testClient, "https://example.org/authorized-oauth-return"],
    );
  });

  afterAll(async () => {
    try {
      await query("delete from remote_mcp_oauth_clients where client_id = $1", [testClient]);
    } finally {
      await db?.close();
    }
  });

  it("detects all five migration generations and refuses disabled clients", async () => {
    const report = await inspectRemoteMcpReleasePrerequisites({}, query);
    expect(status(report, "oauth_database_schema")).toBe("configured");
    expect(status(report, "enabled_exact_client_registrations")).toBe("blocked");
    expect(report.publicMcpReleaseApproved).toBe(false);
    expect(JSON.stringify(report)).not.toContain(testClient);
  });

  it("recognizes a deliberately enabled exact-match client without approving release", async () => {
    await query("update remote_mcp_oauth_clients set enabled = true where client_id = $1", [testClient]);
    try {
      const report = await inspectRemoteMcpReleasePrerequisites({}, query);
      expect(status(report, "oauth_database_schema")).toBe("configured");
      expect(status(report, "enabled_exact_client_registrations")).toBe("configured");
      expect(status(report, "live_installation_user_collaborator_permission")).toBe("manual_required");
      expect(status(report, "live_chatgpt_oauth_mcp_exchange")).toBe("manual_required");
      expect(status(report, "live_claude_oauth_mcp_exchange")).toBe("manual_required");
      expect(report.publicMcpReleaseApproved).toBe(false);
      expect(JSON.stringify(report)).not.toContain(testClient);
    } finally {
      await query("update remote_mcp_oauth_clients set enabled = false where client_id = $1", [testClient]);
    }
  });
});
