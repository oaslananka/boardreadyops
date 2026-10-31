import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DataExportPreparationStore,
  ExportPreparationInputError,
} from "../../../packages/db/src/data-export-preparation-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const bytes = Buffer.from('{"kind":"boardreadyops.repository-metadata-export"}', "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const request = { exportId: "export-1", tenantId: "tenant-a", installationId: "install-a", actorLogin: "operator" };
const lease = { ...request, workerId: "worker-a", token: "claim-a" };
const expiry = new Date("2030-01-01T12:00:00.000Z");
function storeWithQueries(rows: Record<string, unknown>[][]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows: rows.shift() ?? [] }));
  return { store: new DataExportPreparationStore({ query } as SqlQueryExecutor), query };
}

describe("metadata preview publication, authorization, expiry and revocation", () => {
  it("publishes once under a verified worker lease without completing the export", async () => {
    const { store, query } = storeWithQueries([
      [{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }],
      [{ manifest_preview_expires_at: expiry }],
    ]);
    await expect(store.publishStagedManifestPreview(lease)).resolves.toBe(expiry.toISOString());
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls[1]?.[0] as string;
    expect(sql).toContain("preparation_lease_until > NOW()");
    expect(sql).toContain("manifest_preview_expires_at IS NULL");
    expect(sql).toContain("manifest_preview_revoked_at IS NULL");
    expect(sql).toContain("repositories.disabled_at IS NULL");
    expect(sql).not.toContain("status='completed'");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "export-1",
      "tenant-a",
      "install-a",
      "worker-a",
      "claim-a",
      sha256,
      bytes.length,
    ]);
  });

  it("fails closed if the original lease has no staged bytes or the compare-and-set loses ownership", async () => {
    const missing = storeWithQueries([[]]);
    await expect(missing.store.publishStagedManifestPreview(lease)).resolves.toBeNull();
    expect(missing.query).toHaveBeenCalledOnce();
    const lost = storeWithQueries([[{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }], []]);
    await expect(lost.store.publishStagedManifestPreview(lease)).resolves.toBeNull();
    expect(lost.query).toHaveBeenCalledTimes(2);
  });

  it("rejects wrong worker identities and corrupted staged bytes before attempting publication", async () => {
    const invalid = storeWithQueries([]);
    await expect(invalid.store.publishStagedManifestPreview({ ...lease, token: " " })).rejects.toThrow(
      ExportPreparationInputError,
    );
    expect(invalid.query).not.toHaveBeenCalled();
    const corrupt = storeWithQueries([[{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: "0".repeat(64) }]]);
    await expect(corrupt.store.publishStagedManifestPreview(lease)).rejects.toThrow(
      "Persisted export manifest failed integrity verification",
    );
    expect(corrupt.query).toHaveBeenCalledOnce();
  });

  it("reads only the persisted, authorized, non-revoked live scope", async () => {
    const { store, query } = storeWithQueries([[{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }]]);
    await expect(store.readPublishedManifestPreview(request)).resolves.toMatchObject({
      sha256,
      byteLength: bytes.length,
      bytes,
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["export-1", "tenant-a", "install-a", "operator"]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("lower(data_exports.requested_by)=lower($4)");
    expect(sql).toContain("manifest_preview_expires_at > NOW()");
    expect(sql).toContain("manifest_preview_revoked_at IS NULL");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("repositories.installation_id=installations.id");
  });

  it("denies missing previews and refuses invalid identities, size and digest", async () => {
    const missing = storeWithQueries([[]]);
    expect(await missing.store.readPublishedManifestPreview(request)).toBeNull();
    await expect(missing.store.readPublishedManifestPreview({ ...request, installationId: " " })).rejects.toThrow(
      ExportPreparationInputError,
    );
    expect(missing.query).toHaveBeenCalledOnce();
    for (const row of [
      { prepared_manifest_bytes: Buffer.alloc(65537), prepared_manifest_sha256: sha256 },
      { prepared_manifest_bytes: bytes, prepared_manifest_sha256: "0".repeat(64) },
      { prepared_manifest_bytes: null, prepared_manifest_sha256: sha256 },
    ]) {
      const invalid = storeWithQueries([[row]]);
      await expect(invalid.store.readPublishedManifestPreview(request)).rejects.toThrow(
        "Persisted export manifest failed integrity verification",
      );
    }
  });

  it("revokes once for the original requester and exact active installation", async () => {
    const args = { ...request, actorLogin: "operator" };
    const { store, query } = storeWithQueries([[{ id: request.exportId }], []]);
    expect(await store.revokePublishedManifestPreview(args)).toBe(true);
    expect(await store.revokePublishedManifestPreview(args)).toBe(false);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("lower(requested_by)=lower($4)");
    expect(sql).toContain("manifest_preview_revoked_at IS NULL");
    expect(sql).toContain("repositories.installation_id=installations.id");
    expect(query.mock.calls[0]?.[1]).toEqual(["export-1", "tenant-a", "install-a", "operator"]);
    await expect(store.revokePublishedManifestPreview({ ...args, actorLogin: "" })).rejects.toThrow(
      ExportPreparationInputError,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
