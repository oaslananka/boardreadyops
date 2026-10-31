import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataExportInventoryStore } from "../../packages/db/src/data-export-inventory.js";
import { prepareClaimedExportManifest } from "../../packages/db/src/data-export-manifest.js";
import {
  DataExportPreparationStore,
  ExportPreparationInputError,
} from "../../packages/db/src/data-export-preparation-store.js";
import { DataLifecycleStore } from "../../packages/db/src/data-lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const anotherExecutor = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `export-claim-${randomUUID()}`;
const outsider = `other-claim-${randomUUID()}`;
const installations: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const repositories: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const exported: string[] = [];

function db() {
  if (!executor) throw new Error("Disposable DB required");
  return executor;
}
function store() {
  return new DataExportPreparationStore(db());
}
function otherStore() {
  if (!anotherExecutor) throw new Error("Second independent connection required");
  return new DataExportPreparationStore(anotherExecutor);
}
async function created(scope: "organization" | "repository", scopeId?: string) {
  const id = await store().createBoundPendingExport({
    tenantId: tenant,
    installationId: installations[0],
    requestedBy: "operator",
    scope,
    ...(scopeId === undefined ? {} : { scopeId }),
  });
  if (id) exported.push(id);
  return id;
}

beforeAll(async () => {
  if (!executor) return;
  for (const [i, id] of installations.entries()) {
    await db().query(
      `INSERT INTO installations(id, github_installation_id, account_login, account_type)
       VALUES($1,$2,$3,'Organization')`,
      [id, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + i, i === 2 ? outsider : tenant],
    );
    await db().query(
      `INSERT INTO repositories(id, installation_id, github_repo_id, owner, name, default_branch)
       VALUES($1,$2,$3,$4,$5,'main')`,
      [
        repositories[i],
        id,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + i,
        i === 2 ? outsider : tenant,
        `board-${i}`,
      ],
    );
  }
});
afterAll(async () => {
  if (!executor) return;
  try {
    await db().query("DELETE FROM data_exports WHERE id = ANY($1::text[])", [exported]);
    await db().query("DELETE FROM installations WHERE id = ANY($1::text[])", [installations]);
  } finally {
    await executor.close();
    await anotherExecutor?.close();
  }
});

describeDatabase("installation-bound read-only export preparation claims (PostgreSQL)", () => {
  it("rejects malformed identities and cross-tenant/repository writes", async () => {
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: " padded ",
        requestedBy: "operator",
        scope: "organization",
      }),
    ).rejects.toThrow(ExportPreparationInputError);
    await expect(
      store().createBoundPendingExport({
        tenantId: outsider,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "organization",
      }),
    ).resolves.toBeNull();
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "repository",
        scopeId: repositories[1],
      }),
    ).resolves.toBeNull();
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "repository",
        scopeId: repositories[0],
      }),
    ).resolves.toMatch(/^[0-9a-f-]{36}$/u);
    // The scope-allowed request above must be cleaned up without touching another tenant.
    const r = await db().query("SELECT id FROM data_exports WHERE installation_id = $1", [installations[0]]);
    for (const row of (r as { rows: Array<{ id: string }> }).rows) {
      if (!exported.includes(row.id)) exported.push(row.id);
      // Avoid leaking a fixture from this scope test into the claim-order test.
      await db().query("DELETE FROM data_exports WHERE id = $1", [row.id]);
    }
  });

  it("shows export metadata only to the owning live installation, not a same-tenant sibling", async () => {
    const id = await created("repository", repositories[0]);
    expect(id).toBeTruthy();
    if (!id) throw new Error("expected repo-bound export");
    const status = new DataLifecycleStore(db());
    expect(await status.getExport(tenant, id, installations[0])).toMatchObject({
      id,
      tenantId: tenant,
      scope: "repository",
      scopeId: repositories[0],
      status: "pending",
    });
    // Both installations belong to the same tenant, but the claim belongs to exactly one.
    expect(await status.getExport(tenant, id, installations[1])).toBeNull();
    expect(await status.getExport(outsider, id, installations[0])).toBeNull();
    expect(await status.getExport(tenant, id, installations[2])).toBeNull();

    await db().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositories[0]]);
    try {
      expect(await status.getExport(tenant, id, installations[0])).toBeNull();
    } finally {
      await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositories[0]]);
    }
    await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[0]]);
    try {
      expect(await status.getExport(tenant, id, installations[0])).toBeNull();
    } finally {
      await db().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installations[0]]);
    }
    expect(await status.getExport(tenant, id, installations[0])).toMatchObject({ id });

    // The historical unbound organization request cannot be attributed safely.
    const old = randomUUID();
    exported.push(old);
    await db().query(
      "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope) VALUES ($1,$2,'operator','pending','organization')",
      [old, tenant],
    );
    expect(await status.getExport(tenant, old, installations[0])).toBeNull();

    // Legacy unbound user-scope status remains visible without claiming package delivery.
    const user = randomUUID();
    exported.push(user);
    await db().query(
      "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id) VALUES ($1,$2,'operator','pending','user','operator')",
      [user, tenant],
    );
    expect(await status.getExport(tenant, user, installations[0])).toMatchObject({
      id: user,
      status: "pending",
      scope: "user",
    });
    // Do not leave an extra pending export for the following claim-order test.
    await db().query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [[id, old, user]]);
  });

  it("claims only installation-bound requests; old unbound rows remain untouched", async () => {
    const old = randomUUID();
    exported.push(old);
    await db().query(
      "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope) VALUES ($1,$2,'operator','pending','organization')",
      [old, tenant],
    );
    const id = await created("organization");
    expect(id).toBeTruthy();
    const claims = await Promise.all([
      store().claimNext({ installationId: installations[0], workerId: "worker-a" }),
      otherStore().claimNext({ installationId: installations[0], workerId: "worker-b" }),
    ]);
    const claimed = claims.filter((c) => c !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      exportId: id,
      tenantId: tenant,
      installationId: installations[0],
      attemptCount: 1,
    });
    expect(await store().claimNext({ installationId: installations[0], workerId: "worker-c" })).toBeNull();
    expect(await store().claimNext({ installationId: installations[1], workerId: "worker-c" })).toBeNull();
    const oldRow = await db().query("SELECT status,installation_id FROM data_exports WHERE id=$1", [old]);
    expect((oldRow as { rows: Array<{ status: string; installation_id: string | null }> }).rows[0]).toEqual({
      status: "pending",
      installation_id: null,
    });
    const token = claimed[0];
    if (!token) throw new Error("expected claim");
    const inventoryStore = new DataExportInventoryStore(db());
    const prepared = await prepareClaimedExportManifest(inventoryStore, {
      exportId: token.exportId,
      installationId: token.installationId,
      tenantId: token.tenantId,
      workerId: token.workerId,
      token: token.token,
    });
    expect(prepared?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const bytes = prepared?.bytes.toString("utf8") ?? "";
    expect(bytes).toContain("boardreadyops.repository-metadata-export");
    expect(bytes).not.toContain("storage_path");
    await expect(
      prepareClaimedExportManifest(inventoryStore, {
        exportId: token.exportId,
        installationId: token.installationId,
        tenantId: token.tenantId,
        workerId: token.workerId,
        token: "wrong-token",
      }),
    ).resolves.toBeNull();
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: installations[1],
        workerId: token.workerId,
        token: token.token,
      }),
    ).toBe(false);
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: token.installationId,
        workerId: token.workerId,
        token: "wrong-token",
      }),
    ).toBe(false);
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: token.installationId,
        workerId: token.workerId,
        token: token.token,
      }),
    ).toBe(true);
    const second = await otherStore().claimNext({ installationId: installations[0], workerId: "worker-second" });
    expect(second).toMatchObject({ exportId: id, attemptCount: 2 });
    expect(second?.token).not.toEqual(token.token);
  });

  it("never automatically reclaims expired work and rejects stale completions", async () => {
    const running = await db().query(
      "SELECT id FROM data_exports WHERE status='running' AND installation_id=$1 LIMIT 1",
      [installations[0]],
    );
    const id = (running as { rows: Array<{ id: string }> }).rows[0]?.id;
    expect(id).toBeTruthy();
    await db().query("UPDATE data_exports SET preparation_lease_until = NOW() - interval '1 second' WHERE id=$1", [id]);
    expect(await store().claimNext({ installationId: installations[0], workerId: "worker-third" })).toBeNull();
    const claim = await db().query("SELECT preparation_worker,preparation_token,status FROM data_exports WHERE id=$1", [
      id,
    ]);
    const value = (claim as { rows: Array<{ preparation_worker: string; preparation_token: string; status: string }> })
      .rows[0];
    expect(value?.status).toBe("running");
    await expect(
      prepareClaimedExportManifest(new DataExportInventoryStore(db()), {
        exportId: id ?? "",
        installationId: installations[0],
        tenantId: tenant,
        workerId: value?.preparation_worker ?? "",
        token: value?.preparation_token ?? "",
      }),
    ).resolves.toBeNull();
    expect(
      await store().releaseReadOnlyClaim({
        exportId: id ?? "",
        installationId: installations[0],
        workerId: value?.preparation_worker ?? "",
        token: value?.preparation_token ?? "",
      }),
    ).toBe(false);
  });

  it("persists a bounded manifest under its original unexpired lease without completing or publishing it", async () => {
    const id = await store().createBoundPendingExport({
      tenantId: tenant,
      installationId: installations[1],
      requestedBy: "operator",
      scope: "repository",
      scopeId: repositories[1],
    });
    expect(id).toBeTruthy();
    if (!id) throw new Error("expected installation-bound export");
    exported.push(id);
    const claim = await store().claimNext({ installationId: installations[1], workerId: "stage-worker" });
    expect(claim).toMatchObject({ exportId: id, tenantId: tenant, scope: "repository" });
    if (!claim) throw new Error("expected lease");
    const input = {
      exportId: claim.exportId,
      tenantId: claim.tenantId,
      installationId: claim.installationId,
      workerId: claim.workerId,
      token: claim.token,
    };
    const prepared = await store().stageClaimedManifest(input);
    expect(prepared?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared?.byteLength).toBeGreaterThan(0);
    const read = await otherStore().readStagedManifest(input);
    expect(read?.bytes.byteLength).toBe(prepared?.byteLength);
    expect(read?.sha256).toBe(prepared?.sha256);
    expect(JSON.parse(read?.bytes.toString("utf8") ?? "{}")).toMatchObject({
      formatVersion: 1,
      kind: "boardreadyops.repository-metadata-export",
      exportId: id,
      tenantId: tenant,
      scope: "repository",
      scopeId: repositories[1],
    });
    const persisted = await db().query(
      "SELECT status,prepared_manifest_bytes,prepared_manifest_sha256,download_url,completed_at FROM data_exports WHERE id=$1",
      [id],
    );
    const record = (
      persisted as {
        rows: Array<{
          status: string;
          prepared_manifest_bytes: Buffer;
          prepared_manifest_sha256: string;
          download_url: string | null;
          completed_at: Date | null;
        }>;
      }
    ).rows[0];
    expect(record).toMatchObject({ status: "running", download_url: null, completed_at: null });
    expect(record?.prepared_manifest_bytes.equals(read?.bytes ?? Buffer.alloc(0))).toBe(true);
    expect(record?.prepared_manifest_sha256).toBe(read?.sha256);
    // The DB itself rejects inconsistent metadata and over-limit package bytes.
    await expect(
      db().query("UPDATE data_exports SET prepared_manifest_sha256=NULL WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db().query("UPDATE data_exports SET prepared_manifest_bytes=$2 WHERE id=$1", [id, Buffer.alloc(65537)]),
    ).rejects.toMatchObject({ code: "23514" });
    // A syntactically valid but corrupted checksum must fail readback as well.
    await db().query("UPDATE data_exports SET prepared_manifest_sha256=$2 WHERE id=$1", [id, "0".repeat(64)]);
    await expect(otherStore().readStagedManifest(input)).rejects.toThrow(
      "Persisted export manifest failed integrity verification",
    );
    await db().query("UPDATE data_exports SET prepared_manifest_sha256=$2 WHERE id=$1", [id, prepared?.sha256]);
    expect((await otherStore().readStagedManifest(input))?.sha256).toBe(prepared?.sha256);
    expect(await store().stageClaimedManifest(input)).toBeNull();
    expect(await store().releaseReadOnlyClaim(input)).toBe(false);
    expect(await store().readStagedManifest({ ...input, token: "stolen-claim" })).toBeNull();
    expect(await otherStore().readStagedManifest({ ...input, installationId: installations[0] })).toBeNull();
    await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[1]]);
    expect(await otherStore().readStagedManifest(input)).toBeNull();
    expect(await store().stageClaimedManifest(input)).toBeNull();
    await db().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installations[1]]);
    await db().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [id]);
    expect(await otherStore().readStagedManifest(input)).toBeNull();
    expect(await store().releaseReadOnlyClaim(input)).toBe(false);
    const after = await db().query("SELECT status,prepared_manifest_bytes FROM data_exports WHERE id=$1", [id]);
    expect((after as { rows: Array<{ status: string; prepared_manifest_bytes: Buffer }> }).rows[0]).toMatchObject({
      status: "running",
    });
  });

  it("publishes only short, revocable metadata preview to its current installation", async () => {
    const id = await store().createBoundPendingExport({
      tenantId: tenant,
      installationId: installations[1],
      requestedBy: "operator",
      scope: "repository",
      scopeId: repositories[1],
    });
    expect(id).toBeTruthy();
    if (!id) throw new Error("expected bound export");
    exported.push(id);
    const claim = await store().claimNext({ installationId: installations[1], workerId: "preview-worker" });
    expect(claim?.exportId).toBe(id);
    if (!claim) throw new Error("expected preview reservation");
    const lease = {
      exportId: id,
      tenantId: tenant,
      installationId: installations[1],
      workerId: claim.workerId,
      token: claim.token,
    };
    const viewer = { exportId: id, tenantId: tenant, installationId: installations[1], actorLogin: "operator" };
    expect(await otherStore().readPublishedManifestPreview(viewer)).toBeNull();
    const stage = await store().stageClaimedManifest(lease);
    expect(stage?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const expiry = await store().publishStagedManifestPreview(lease);
    expect(expiry).toBeTruthy();
    expect(Date.parse(expiry ?? "")).toBeGreaterThan(Date.now());
    expect(await store().publishStagedManifestPreview(lease)).toBeNull();
    const preview = await otherStore().readPublishedManifestPreview(viewer);
    expect(preview?.sha256).toBe(stage?.sha256);
    expect(JSON.parse(preview?.bytes.toString("utf8") ?? "{}")).toMatchObject({
      kind: "boardreadyops.repository-metadata-export",
      exportId: id,
      tenantId: tenant,
    });
    expect(await store().readPublishedManifestPreview({ ...viewer, installationId: installations[0] })).toBeNull();
    expect(await store().readPublishedManifestPreview({ ...viewer, tenantId: outsider })).toBeNull();
    expect(await store().readPublishedManifestPreview({ ...viewer, actorLogin: "another-user" })).toBeNull();
    await db().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositories[1]]);
    expect(await store().readPublishedManifestPreview(viewer)).toBeNull();
    await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositories[1]]);
    await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[1]]);
    expect(await store().readPublishedManifestPreview(viewer)).toBeNull();
    await db().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installations[1]]);
    await db().query("UPDATE data_exports SET manifest_preview_expires_at=NOW()-interval '1 second' WHERE id=$1", [id]);
    expect(await store().readPublishedManifestPreview(viewer)).toBeNull();
    await db().query("UPDATE data_exports SET manifest_preview_expires_at=NOW()+interval '5 minutes' WHERE id=$1", [
      id,
    ]);
    expect(await store().revokePublishedManifestPreview({ ...viewer, actorLogin: "stranger" })).toBe(false);
    expect(
      await store().revokePublishedManifestPreview({
        ...viewer,
        installationId: installations[0],
        actorLogin: "operator",
      }),
    ).toBe(false);
    expect(await store().revokePublishedManifestPreview({ ...viewer, actorLogin: "operator" })).toBe(true);
    expect(await store().revokePublishedManifestPreview({ ...viewer, actorLogin: "operator" })).toBe(false);
    expect(await store().readPublishedManifestPreview(viewer)).toBeNull();
    expect(await store().publishStagedManifestPreview(lease)).toBeNull();
    const final = await db().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [id]);
    expect((final as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("refuses new reservations after suspension without erasing prior requests", async () => {
    await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[1]]);
    expect(
      await store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[1],
        requestedBy: "operator",
        scope: "organization",
      }),
    ).toBeNull();
    expect(await store().claimNext({ installationId: installations[1], workerId: "worker-x" })).toBeNull();
  });
});
