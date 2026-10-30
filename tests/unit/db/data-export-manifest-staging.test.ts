import { describe, expect, it, vi } from "vitest";
import { buildPendingExportManifest } from "../../../packages/db/src/data-export-manifest.js";
import { DataExportPreparationStore } from "../../../packages/db/src/data-export-preparation-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const input = {
  exportId: "export-123",
  tenantId: "example-org",
  installationId: "inst-1",
  workerId: "worker-1",
  token: "lease-token",
};
const inventory = {
  formatVersion: 1 as const,
  exportId: input.exportId,
  tenantId: input.tenantId,
  scope: "organization" as const,
  scopeId: null,
  coverage: "selected-installation-repositories-only" as const,
  repositories: [],
};
const prepared = buildPendingExportManifest(inventory);
const inventoryRow = {
  id: inventory.exportId,
  tenant_id: inventory.tenantId,
  scope: inventory.scope,
  scope_id: inventory.scopeId,
  repositories: [],
};
function setup(options: { unavailable?: boolean; declined?: boolean; corrupted?: boolean; unreadable?: boolean } = {}) {
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("WITH allowed_request AS MATERIALIZED"))
      return { rows: options.unavailable ? [] : [inventoryRow] };
    if (sql.includes("SET prepared_manifest_bytes = $6")) {
      expect(params?.slice(0, 5)).toEqual([
        input.exportId,
        input.tenantId,
        input.installationId,
        input.workerId,
        input.token,
      ]);
      expect(params?.[5]).toEqual(prepared.bytes);
      expect(params?.[6]).toBe(prepared.sha256);
      return { rows: options.declined ? [] : [{ id: input.exportId }] };
    }
    if (sql.includes("SELECT data_exports.prepared_manifest_bytes"))
      return {
        rows: options.unreadable
          ? []
          : [
              {
                prepared_manifest_bytes: prepared.bytes,
                prepared_manifest_sha256: options.corrupted ? "0".repeat(64) : prepared.sha256,
              },
            ],
      };
    throw new Error("Unexpected SQL statement in staging test");
  });
  return { store: new DataExportPreparationStore({ query } as SqlQueryExecutor), query };
}

describe("durable export manifest staging (no customer delivery)", () => {
  it("saves only an owner-claimed manifest and verifies a persisted digest without reporting completion", async () => {
    const { store, query } = setup();
    await expect(store.stageClaimedManifest(input)).resolves.toEqual({
      sha256: prepared.sha256,
      byteLength: prepared.byteLength,
    });
    expect(query).toHaveBeenCalledTimes(3);
    const [sql] = query.mock.calls[1] ?? [];
    expect(sql).toContain("preparation_lease_until > NOW()");
    expect(sql).toContain("prepared_manifest_bytes IS NULL");
    expect(sql).toContain("repositories.installation_id = installations.id");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).not.toContain("status = 'completed'");
    expect(sql).not.toContain("download_url");
  });

  it("does not write when the scoped inventory is no longer available", async () => {
    const { store, query } = setup({ unavailable: true });
    await expect(store.stageClaimedManifest(input)).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not report a package when the atomic lease ownership update fails", async () => {
    const { store, query } = setup({ declined: true });
    await expect(store.stageClaimedManifest(input)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("reports a verifiable staging error instead of claiming the wrong persisted checksum", async () => {
    const { store, query } = setup({ corrupted: true });
    await expect(store.stageClaimedManifest(input)).rejects.toThrow(
      "Persisted export manifest failed integrity verification",
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not report success when the just-written package becomes unreadable under its lease", async () => {
    const { store, query } = setup({ unreadable: true });
    await expect(store.stageClaimedManifest(input)).rejects.toThrow(
      "Persisted export manifest failed integrity verification",
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("returns only bounded and checksum-matching bytes for the current scoped lease", async () => {
    const { store, query } = setup();
    await expect(store.readStagedManifest(input)).resolves.toEqual(prepared);
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("preparation_lease_until > NOW()");
    expect(params).toEqual([input.exportId, input.tenantId, input.installationId, input.workerId, input.token]);
  });

  it("returns no bytes when the reservation is unavailable and rejects malformed persisted data", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const missing = new DataExportPreparationStore({ query } as SqlQueryExecutor);
    expect(await missing.readStagedManifest(input)).toBeNull();
    for (const bad of [
      { prepared_manifest_bytes: null, prepared_manifest_sha256: prepared.sha256 },
      { prepared_manifest_bytes: Buffer.alloc(0), prepared_manifest_sha256: prepared.sha256 },
      { prepared_manifest_bytes: Buffer.alloc(65537), prepared_manifest_sha256: prepared.sha256 },
      { prepared_manifest_bytes: prepared.bytes, prepared_manifest_sha256: null },
      { prepared_manifest_bytes: prepared.bytes, prepared_manifest_sha256: "x".repeat(64) },
      { prepared_manifest_bytes: prepared.bytes, prepared_manifest_sha256: "0".repeat(64) },
    ]) {
      const db = { query: vi.fn(async () => ({ rows: [bad] })) } as SqlQueryExecutor;
      await expect(new DataExportPreparationStore(db).readStagedManifest(input)).rejects.toThrow(
        "Persisted export manifest failed integrity verification",
      );
    }
  });
});
