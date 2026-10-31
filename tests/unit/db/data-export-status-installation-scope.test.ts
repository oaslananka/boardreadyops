import { describe, expect, it, vi } from "vitest";
import { DataLifecycleStore } from "../../../packages/db/src/data-lifecycle-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const row = {
  id: "export-1",
  tenant_id: "organization-a",
  requested_by: "operator",
  status: "pending",
  scope: "repository",
  scope_id: "repo-a",
  download_url: null,
  expires_at: null,
  created_at: new Date("2026-10-30T00:00:00.000Z"),
};
function mockStore(rows: Record<string, unknown>[] = [row]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { store: new DataLifecycleStore({ query } as SqlQueryExecutor), query };
}

describe("exact-installation export status authorization", () => {
  it("requires three canonical identities before querying storage", async () => {
    const { store, query } = mockStore();
    for (const args of [
      ["", "export-1", "inst-a"],
      ["org", "", "inst-a"],
      ["org", "export-1", ""],
      [" org", "export-1", "inst-a"],
      ["org", " export-1", "inst-a"],
      ["org", "export-1", "inst-a "],
    ] as const) {
      expect(await store.getExport(args[0], args[1], args[2])).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("checks live installation, same-tenant ownership, and enabled repository in the SQL boundary", async () => {
    const { store, query } = mockStore();
    await expect(store.getExport("organization-a", "export-1", "inst-a")).resolves.toEqual({
      id: "export-1",
      tenantId: "organization-a",
      requestedBy: "operator",
      status: "pending",
      scope: "repository",
      scopeId: "repo-a",
      downloadUrl: null,
      expiresAt: null,
      createdAt: "2026-10-30T00:00:00.000Z",
    });
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(["export-1", "organization-a", "inst-a"]);
    expect(sql).toContain("installations.id = $3");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("lower(installations.account_login) = lower($2)");
    expect(sql).toContain("data_exports.installation_id = installations.id");
    expect(sql).toContain("repositories.installation_id = installations.id");
    expect(sql).toContain("repositories.disabled_at IS NULL");
    expect(sql).not.toContain("data_exports.installation_id IS NULL AND data_exports.scope = 'user'");
    expect(sql).not.toContain("data_exports.*");
    expect(sql).not.toContain("data_exports.download_url");
    expect(sql).toContain("data_exports.scope = 'organization' AND data_exports.scope_id IS NULL");
  });

  it("fails closed when the scoped record is absent", async () => {
    const { store, query } = mockStore([]);
    await expect(store.getExport("organization-a", "other-export", "inst-a")).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it("returns metadata without loading or exposing a stored signed download URL", async () => {
    const { store, query } = mockStore([{ ...row, download_url: "https://example.invalid/secret-capability" }]);
    const result = await store.getExport("organization-a", "export-1", "inst-a");
    expect(result).toMatchObject({ scope: "repository", status: "pending", downloadUrl: null });
    expect(query.mock.calls[0]?.[0]).not.toContain("data_exports.download_url");
  });
});
