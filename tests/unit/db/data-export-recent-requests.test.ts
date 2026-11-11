import { describe, expect, it, vi } from "vitest";
import {
  DataExportPreparationStore,
  ExportPreparationInputError,
} from "../../../packages/db/src/data-export-preparation-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const requester = { tenantId: "account-a", installationId: "inst-a", actorLogin: "Owner" };

describe("recent requester export history", () => {
  it("rejects malformed caller identities before any database access", async () => {
    const query = vi.fn();
    const store = new DataExportPreparationStore({ query } as unknown as SqlQueryExecutor);
    for (const invalid of [
      { ...requester, tenantId: " account-a" },
      { ...requester, installationId: "" },
      { ...requester, actorLogin: "Owner " },
    ]) {
      await expect(store.listRecentForRequester(invalid)).rejects.toThrow(ExportPreparationInputError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("returns only bounded safe receipt fields from the original requester and authorized installation", async () => {
    const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({
      rows: [
        {
          id: "abc-1",
          status: "running",
          created_at: new Date("2026-11-11T09:00:00.000Z"),
          download_url: "https://forbidden.example/secret",
          requested_by: "Owner",
          scope_id: "private-repo",
        },
      ],
    }));
    const store = new DataExportPreparationStore({ query } as unknown as SqlQueryExecutor);
    await expect(store.listRecentForRequester(requester)).resolves.toEqual([
      { exportId: "abc-1", status: "running", createdAt: "2026-11-11T09:00:00.000Z" },
    ]);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(["account-a", "inst-a", "Owner"]);
    expect(sql).toContain("data_exports.installation_id = $2");
    expect(sql).toContain("lower(data_exports.requested_by) = lower($3)");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("lower(installations.account_login) = lower(data_exports.tenant_id)");
    expect(sql).toContain("repositories.installation_id = installations.id");
    expect(sql).toContain("repositories.disabled_at IS NULL");
    expect(sql).toContain("data_exports.scope = 'organization'");
    expect(sql).toContain("data_exports.scope = 'repository'");
    expect(sql).toContain("ORDER BY data_exports.created_at DESC, data_exports.id DESC");
    expect(sql).toContain("LIMIT 10");
    expect(sql).not.toContain("data_exports.download_url");
  });

  it("parses timestamp strings, supports persisted statuses, and refuses malformed dates or ids", async () => {
    const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({
      rows: [{ id: "valid-1", status: "pending", created_at: "2026-11-11T09:00:00.000Z" }],
    }));
    const store = new DataExportPreparationStore({ query } as unknown as SqlQueryExecutor);
    for (const status of ["pending", "running", "completed", "failed"] as const) {
      query.mockResolvedValueOnce({
        rows: [{ id: "valid-1", status, created_at: "2026-11-11T09:00:00.000Z" }],
      });
      await expect(store.listRecentForRequester(requester)).resolves.toEqual([
        { exportId: "valid-1", status, createdAt: "2026-11-11T09:00:00.000Z" },
      ]);
    }
    for (const bad of [
      { id: "", status: "pending", created_at: "2026-11-11T09:00:00.000Z" },
      { id: "valid-1", status: "running", created_at: "not-a-date" },
    ]) {
      query.mockResolvedValueOnce({ rows: [bad] });
      await expect(store.listRecentForRequester(requester)).rejects.toThrow("Invalid persisted export request");
    }
  });

  it("fails closed on malformed stored status rows instead of showing untrusted receipts", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "abc-1", status: "unknown", created_at: new Date() }] }));
    const store = new DataExportPreparationStore({ query } as unknown as SqlQueryExecutor);
    await expect(store.listRecentForRequester(requester)).rejects.toThrow("Invalid persisted export request");
  });
});
