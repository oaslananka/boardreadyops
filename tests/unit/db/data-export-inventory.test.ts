import { describe, expect, it, vi } from "vitest";
import {
  DataExportInventoryStore,
  ExportInventoryUnavailableError,
} from "../../../packages/db/src/data-export-inventory.js";

const input = { exportId: "exp-1", tenantId: "ExampleOrg", installationId: "installation-a" };

const scopeRow = {
  id: "exp-1",
  tenant_id: "ExampleOrg",
  scope: "organization",
  scope_id: null,
  repositories: [
    {
      id: "repo-a",
      github_repo_id: "1001",
      owner: "ExampleOrg",
      name: "board",
      private: true,
      disabled: false,
      storage_path: "/private/never-return-this-path",
      token: "never-return-this-secret",
    },
  ],
};

describe("preparation-only data export inventory", () => {
  it("reads an authorized pending export and only selected-installation repository metadata", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [scopeRow] });
    const snapshot = await new DataExportInventoryStore({ query }).previewPendingExport(input);
    expect(snapshot).toEqual({
      formatVersion: 1,
      exportId: "exp-1",
      tenantId: "ExampleOrg",
      scope: "organization",
      scopeId: null,
      coverage: "selected-installation-repositories-only",
      repositories: [
        {
          repositoryId: "repo-a",
          githubRepositoryId: "1001",
          owner: "ExampleOrg",
          name: "board",
          private: true,
          disabled: false,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("storage_path");
    expect(JSON.stringify(snapshot)).not.toContain("token");
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["exp-1", "ExampleOrg", "installation-a"]);
    expect(sql).toContain("installations.id = $3");
    expect(sql).toContain("data_exports.installation_id = installations.id");
    expect(sql).toContain("repositories.installation_id = allowed_request.installation_id");
    expect(sql).toContain("lower(installations.account_login) = lower(data_exports.tenant_id)");
    expect(sql).toContain("data_exports.status = 'pending'");
    expect(sql).toContain("LIMIT 101");
    expect(sql).not.toMatch(/from findings|from artifacts|from api_tokens|storage_path/iu);
  });

  it("reads a claimed export only through the worker/token and unexpired lease predicates", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [scopeRow] });
    const store = new DataExportInventoryStore({ query });
    const claim = { ...input, workerId: "worker-a", token: "reservation-a" };
    const found = await store.previewClaimedExport(claim);
    expect(found?.repositories).toHaveLength(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["exp-1", "ExampleOrg", "installation-a", "worker-a", "reservation-a"]);
    expect(sql).toContain("data_exports.status = 'running'");
    expect(sql).toContain("data_exports.preparation_worker = $4");
    expect(sql).toContain("data_exports.preparation_token = $5");
    expect(sql).toContain("data_exports.preparation_lease_until > NOW()");
    expect(sql).toContain("installations.suspended_at IS NULL");

    query.mockResolvedValueOnce({ rows: [] });
    await expect(store.previewClaimedExport({ ...claim, token: "wrong-token" })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    await expect(store.previewClaimedExport({ ...claim, workerId: " padded " })).rejects.toBeInstanceOf(
      ExportInventoryUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid database rows rather than returning partial or unsafe metadata", async () => {
    const badRows = [
      { ...scopeRow, id: null },
      { ...scopeRow, repositories: {} },
      { ...scopeRow, scope: "repository", scope_id: "repo-a", repositories: [] },
      { ...scopeRow, repositories: [{ ...scopeRow.repositories[0], private: "true" }] },
      { ...scopeRow, repositories: [null] },
    ];
    const query = vi.fn();
    const store = new DataExportInventoryStore({ query });
    for (const bad of badRows) {
      query.mockResolvedValueOnce({ rows: [bad] });
      await expect(store.previewPendingExport(input)).rejects.toBeInstanceOf(ExportInventoryUnavailableError);
    }
    expect(query).toHaveBeenCalledTimes(badRows.length);
  });

  it("fails closed when the export is absent or cannot be attributed to the selected installation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(new DataExportInventoryStore({ query }).previewPendingExport(input)).resolves.toBeNull();
  });

  it("rejects unsupported personal-account scope rather than pretending completeness", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...scopeRow, scope: "user", scope_id: "ExampleOrg", repositories: [] }],
    });
    await expect(new DataExportInventoryStore({ query }).previewPendingExport(input)).rejects.toBeInstanceOf(
      ExportInventoryUnavailableError,
    );
  });

  it("fails closed when the selected repository is missing", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...scopeRow, scope: "repository", scope_id: "missing-repo", repositories: [] }],
    });
    await expect(new DataExportInventoryStore({ query }).previewPendingExport(input)).rejects.toBeInstanceOf(
      ExportInventoryUnavailableError,
    );
  });

  it("rejects a repository-scoped export if that repository was disabled after request creation", async () => {
    const disabledScope = {
      ...scopeRow,
      scope: "repository",
      scope_id: "repo-a",
      repositories: [{ ...scopeRow.repositories[0], disabled: true }],
    };
    const query = vi.fn().mockResolvedValue({ rows: [disabledScope] });
    const store = new DataExportInventoryStore({ query });

    await expect(store.previewPendingExport(input)).rejects.toBeInstanceOf(ExportInventoryUnavailableError);
    await expect(
      store.previewClaimedExport({ ...input, workerId: "worker-a", token: "lease-token" }),
    ).rejects.toBeInstanceOf(ExportInventoryUnavailableError);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql] of query.mock.calls as [string, unknown[]][]) {
      expect(sql).toMatch(/allowed_request\.scope = 'repository'[\s\S]*?repositories\.disabled_at IS NULL/u);
    }

    // An organization-level inventory is allowed to report that a repository is disabled.
    query.mockResolvedValueOnce({ rows: [{ ...disabledScope, scope: "organization", scope_id: null }] });
    const organizationInventory = await store.previewPendingExport(input);
    expect(organizationInventory?.repositories[0]?.disabled).toBe(true);
  });

  it("rejects inventories larger than the bounded limit rather than silently truncating", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          ...scopeRow,
          repositories: Array.from({ length: 101 }, (_, i) => ({ ...scopeRow.repositories[0], id: `repo-${i}` })),
        },
      ],
    });
    await expect(new DataExportInventoryStore({ query }).previewPendingExport(input)).rejects.toBeInstanceOf(
      ExportInventoryUnavailableError,
    );
  });

  it("does not query for blank, padded or oversized request identifiers", async () => {
    const query = vi.fn();
    const store = new DataExportInventoryStore({ query });
    for (const bad of ["", " ", " padded ", "x".repeat(129)]) {
      await expect(store.previewPendingExport({ ...input, installationId: bad })).rejects.toBeInstanceOf(
        ExportInventoryUnavailableError,
      );
    }
    expect(query).not.toHaveBeenCalled();
  });
});
