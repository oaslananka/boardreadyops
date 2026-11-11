import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DataLifecycleStore } from "../../../packages/db/src/data-lifecycle-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const ownId = randomUUID();

describe("original-GitHub-user historical export request list", () => {
  it("rejects unverified or malformed user ids without database access", async () => {
    const query = vi.fn();
    const store = new DataLifecycleStore({ query } as unknown as SqlQueryExecutor);
    for (const id of [0, -42, 1.5, NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(store.listVerifiedHistoricalUserExportReceipts({ verifiedGitHubUserId: id })).resolves.toEqual([]);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("returns only a bounded, most-recent set of nonsecret USER uninstall receipts", async () => {
    const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({
      rows: [
        {
          id: ownId,
          status: "pending",
          created_at: new Date("2026-11-11T07:00:00Z"),
          tenant_id: "private-account",
          scope_id: "private-account",
          download_url: "https://secret.example.invalid/private",
        },
      ],
    }));
    const store = new DataLifecycleStore({ query } as unknown as SqlQueryExecutor);
    const results = await store.listVerifiedHistoricalUserExportReceipts({ verifiedGitHubUserId: 42 });
    expect(results).toEqual([{ exportId: ownId, status: "pending", createdAt: "2026-11-11T07:00:00.000Z" }]);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual([42]);
    for (const text of [
      "exports.original_github_user_id=$1::bigint",
      "exports.installation_id IS NULL",
      "exports.scope='user'",
      "lower(exports.scope_id)=lower(exports.tenant_id)",
      "exports.requested_by='github_app_uninstall'",
      "erased.status='completed'",
      "erased.dry_run=FALSE",
      "ORDER BY exports.created_at DESC, exports.id DESC",
      "LIMIT 10",
    ])
      expect(sql).toContain(text);
    expect(sql).not.toContain("exports.download_url");
    expect(sql).not.toContain("exports.tenant_id,");
  });

  it("fails closed on unknown status, invalid uuid and corrupt timestamp", async () => {
    const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows: [] as unknown[] }));
    const store = new DataLifecycleStore({ query } as unknown as SqlQueryExecutor);
    for (const row of [
      { id: ownId, status: "unknown", created_at: new Date() },
      { id: "not-a-uuid", status: "pending", created_at: new Date() },
      { id: ownId, status: "pending", created_at: "invalid-timestamp" },
    ]) {
      query.mockResolvedValueOnce({ rows: [row] });
      await expect(store.listVerifiedHistoricalUserExportReceipts({ verifiedGitHubUserId: 42 })).rejects.toThrow(
        "Historical export receipt unavailable",
      );
    }
  });
});
