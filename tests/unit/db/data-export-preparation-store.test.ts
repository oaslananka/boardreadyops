import { describe, expect, it, vi } from "vitest";
import {
  DataExportPreparationStore,
  ExportPreparationInputError,
} from "../../../packages/db/src/data-export-preparation-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const installationId = "installation-1";
const tenantId = "example-org";
const workerId = "worker-1";
const token = "reservation-token";

function fixture(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { store: new DataExportPreparationStore({ query } as unknown as SqlQueryExecutor), query };
}

describe("installation-bound export preparation contract", () => {
  const request = {
    tenantId,
    installationId,
    requestedBy: "operator",
    scope: "organization" as const,
  };

  it("rejects malformed request scope and identities before issuing SQL", async () => {
    const { store, query } = fixture();
    const bad = [
      { ...request, tenantId: " padded " },
      { ...request, installationId: "" },
      { ...request, requestedBy: " " },
      { ...request, scopeId: "repo-1" },
      { ...request, scope: "repository" as const },
      { ...request, scope: "repository" as const, scopeId: " repo-1 " },
    ];
    for (const input of bad) {
      await expect(store.createBoundPendingExport(input)).rejects.toThrow(ExportPreparationInputError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("creates pending exports only through installation and repository ownership predicates", async () => {
    const { store, query } = fixture();
    query.mockImplementation(async (_sql, params) => ({ rows: [{ id: params?.[0] }] }));
    const result = await store.createBoundPendingExport({
      ...request,
      scope: "repository",
      scopeId: "repo-1",
    });
    expect(result).toMatch(/^[0-9a-f-]{36}$/u);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("lower(account_login) = lower($3)");
    expect(sql).toContain("suspended_at IS NULL");
    expect(sql).toContain("repositories.installation_id = owned_installation.id");
    expect(sql).toContain("repositories.disabled_at IS NULL");
    expect(params).toEqual([result, installationId, tenantId, "operator", "repository", "repo-1"]);
  });

  it("returns null without inventing an export when no authorized row was inserted", async () => {
    const { store, query } = fixture();
    await expect(store.createBoundPendingExport(request)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed staged identities before reading or writing a package", async () => {
    const { store, query } = fixture();
    const input = { exportId: "e", tenantId, installationId, workerId, token };
    await expect(store.stageClaimedManifest({ ...input, token: " " })).rejects.toThrow(ExportPreparationInputError);
    await expect(store.readStagedManifest({ ...input, workerId: "worker spaces" })).rejects.toThrow(
      ExportPreparationInputError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("verifies stored bytes against their digest, refusing corrupted output", async () => {
    const bytes = Buffer.from('{"kind":"boardreadyops.repository-metadata-export"}', "utf8");
    const { store, query } = fixture([{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: "0".repeat(64) }]);
    await expect(
      store.readStagedManifest({
        exportId: "e",
        tenantId,
        installationId,
        workerId,
        token,
      }),
    ).rejects.toThrow("Persisted export manifest failed integrity verification");
    expect(query.mock.calls[0]?.[0]).toContain("preparation_lease_until > NOW()");
    expect(query.mock.calls[0]?.[0]).toContain("installations.suspended_at IS NULL");
  });

  it("rejects invalid worker or installation before claiming a lease", async () => {
    const { store, query } = fixture();
    for (const input of [
      { installationId: " padded ", workerId },
      { installationId, workerId: "worker with spaces" },
      { installationId, workerId: "" },
    ]) {
      await expect(store.claimNext(input)).rejects.toThrow(ExportPreparationInputError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("only claims pending scoped rows with a short lease and no expired-claim reclaim", async () => {
    const { store, query } = fixture([
      {
        id: "export-1",
        installation_id: installationId,
        tenant_id: tenantId,
        scope: "repository",
        scope_id: "repo-1",
        preparation_worker: workerId,
        preparation_token: token,
        preparation_lease_until: new Date("2026-10-30T10:00:00Z"),
        preparation_attempts: 1,
      },
    ]);
    await expect(store.claimNext({ installationId, workerId })).resolves.toEqual({
      exportId: "export-1",
      installationId,
      tenantId,
      scope: "repository",
      scopeId: "repo-1",
      workerId,
      token,
      leaseUntil: "2026-10-30T10:00:00.000Z",
      attemptCount: 1,
    });
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("data_exports.status = 'pending'");
    expect(sql).toContain("FOR UPDATE OF data_exports SKIP LOCKED");
    expect(sql).toContain("preparation_lease_until = NOW() + interval '2 minutes'");
    expect(sql).toContain("repositories.installation_id = installations.id");
    expect(params).toEqual([installationId, workerId]);
  });

  it("returns null for absent work and rejects malformed or cross-installation claim results", async () => {
    const empty = fixture();
    await expect(empty.store.claimNext({ installationId, workerId })).resolves.toBeNull();
    const foreign = fixture([
      {
        id: "export-1",
        installation_id: "foreign-installation",
        tenant_id: tenantId,
        scope: "organization",
        scope_id: null,
        preparation_worker: workerId,
        preparation_token: token,
        preparation_lease_until: new Date(),
        preparation_attempts: 1,
      },
    ]);
    await expect(foreign.store.claimNext({ installationId, workerId })).rejects.toThrow(
      "Incomplete preparation reservation",
    );
  });

  it("rejects malformed release identity before SQL and releases only matching active tokens", async () => {
    const valid = { exportId: "export-1", installationId, workerId, token };
    const { store, query } = fixture([{ id: "export-1" }]);
    await expect(store.releaseReadOnlyClaim({ ...valid, token: " padded " })).rejects.toThrow(
      ExportPreparationInputError,
    );
    expect(query).not.toHaveBeenCalled();
    await expect(store.releaseReadOnlyClaim(valid)).resolves.toBe(true);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("preparation_lease_until > NOW()");
    expect(sql).toContain("preparation_token = $4");
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("lower(installations.account_login) = lower(data_exports.tenant_id)");
    expect(params).toEqual(["export-1", installationId, workerId, token]);
    const stale = fixture();
    await expect(stale.store.releaseReadOnlyClaim(valid)).resolves.toBe(false);
  });
});
