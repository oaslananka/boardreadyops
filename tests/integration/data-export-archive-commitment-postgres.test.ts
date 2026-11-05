import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataExportArchiveCommitmentStore } from "../../packages/db/src/data-export-archive-commitment-store.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `zip-intent-${randomUUID()}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const created: string[] = [];
const archive = { sha256: "a".repeat(64), byteLength: 8192, files: 8 };

function db() {
  if (!executor) throw new Error("Disposable PostgreSQL required");
  return executor;
}

async function claimExport() {
  const store = new DataExportPreparationStore(db());
  const exportId = await store.createBoundPendingExport({
    tenantId: tenant,
    installationId,
    requestedBy: "Original-Requester",
    scope: "repository",
    scopeId: repositoryId,
  });
  if (!exportId) throw new Error("Expected bound export");
  created.push(exportId);
  const lease = await store.claimNext({ installationId, workerId: "zip-worker" });
  if (!lease || lease.exportId !== exportId) throw new Error("Expected a worker lease");
  return {
    exportId,
    claim: {
      exportId,
      tenantId: tenant,
      installationId,
      workerId: lease.workerId,
      token: lease.token,
    },
    viewer: { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" },
  };
}

beforeAll(async () => {
  if (!executor) return;
  await db().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await db().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'export-test','main')",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
});

afterAll(async () => {
  if (!executor) return;
  try {
    await db().query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [created]);
    // Archive-stage and revoke evidence is append-only. Keep its installation
    // identity until the isolated disposable PostgreSQL database is destroyed.
    // Deleting it here would violate the immutable audit trail contract.
  } finally {
    await db().close();
  }
});

describeDatabase("claim-bound archive commitment admission (PostgreSQL)", () => {
  it("stages one immutable digest under a live lease without marking an export completed", async () => {
    const { exportId, claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    const staged = await store.stage(claim, archive);
    expect(staged).toMatchObject(archive);
    expect(staged?.expiresAt).toMatch(/Z$/u);
    const evidence = await db().query(
      `SELECT event_type,actor_type,actor_id,actor_login,subject_type,metadata
         FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id`,
      [installationId, exportId],
    );
    expect((evidence as { rows: Record<string, unknown>[] }).rows).toEqual([
      {
        event_type: "data_export.archive.staged",
        actor_type: "system",
        actor_id: "zip-worker",
        actor_login: null,
        subject_type: "data_export",
        metadata: {
          sha256: archive.sha256,
          byteLength: archive.byteLength,
          fileCount: archive.files,
          expiresAt: expect.any(String),
        },
      },
    ]);
    const expiryInAudit =
      (evidence as { rows: Array<{ metadata: { expiresAt: string } }> }).rows[0]?.metadata.expiresAt ?? "";
    expect(Date.parse(expiryInAudit)).toBe(Date.parse(staged?.expiresAt ?? ""));
    expect(JSON.stringify(evidence)).not.toContain(claim.token);
    expect(await store.readForRequester(viewer)).toEqual(staged);
    expect(await store.readForRequester({ ...viewer, actorLogin: "different-user" })).toBeNull();
    expect(await store.readForRequester({ ...viewer, tenantId: "another-tenant" })).toBeNull();
    expect(await store.readForRequester({ ...viewer, installationId: randomUUID() })).toBeNull();
    expect(await store.stage(claim, { ...archive, sha256: "b".repeat(64) })).toBeNull();
    const again = await db().query("SELECT id FROM audit_events WHERE installation_id=$1 AND subject_id=$2", [
      installationId,
      exportId,
    ]);
    expect((again as { rows: unknown[] }).rows).toHaveLength(1);
    const status = await db().query("SELECT status,completed_at,download_url FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((status as { rows: Record<string, unknown>[] }).rows[0]).toEqual({
      status: "running",
      completed_at: null,
      download_url: null,
    });
  });

  it("rejects malformed, out-of-scope and forged lease inputs before staging", async () => {
    const { claim } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    expect(await store.stage({ ...claim, workerId: "with spaces" }, archive)).toBeNull();
    expect(await store.stage({ ...claim, workerId: "another-worker" }, archive)).toBeNull();
    expect(await store.stage({ ...claim, token: "bad-token" }, archive)).toBeNull();
    expect(await store.stage({ ...claim, tenantId: "cross-tenant" }, archive)).toBeNull();
    expect(await store.stage({ ...claim, installationId: randomUUID() }, archive)).toBeNull();
    expect(await store.stage(claim, { ...archive, sha256: "x".repeat(64) })).toBeNull();
    expect(await store.stage(claim, { ...archive, byteLength: 67108865 })).toBeNull();
    expect(await store.stage(claim, { ...archive, files: 109 })).toBeNull();
    expect(await store.stage(claim, archive)).toMatchObject(archive);
  });

  it("denies staging when its repository or installation is disabled, without permanently consuming the request", async () => {
    const { claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    try {
      await db().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositoryId]);
      expect(await store.stage(claim, archive)).toBeNull();
      await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositoryId]);
      await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
      expect(await store.stage(claim, archive)).toBeNull();
    } finally {
      await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositoryId]);
      await db().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
    }
    expect(await store.stage(claim, archive)).toMatchObject(archive);
    expect(await store.readForRequester(viewer)).toMatchObject(archive);
  });

  it("denies original-requester access when repository or installation authority is revoked after staging", async () => {
    const { claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    expect(await store.stage(claim, archive)).toMatchObject(archive);
    try {
      await db().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositoryId]);
      expect(await store.readForRequester(viewer)).toBeNull();
      await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositoryId]);
      await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
      expect(await store.readForRequester(viewer)).toBeNull();
      expect(await store.revokeForRequester(viewer)).toBe(false);
    } finally {
      await db().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositoryId]);
      await db().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
    }
    expect(await store.readForRequester(viewer)).toMatchObject(archive);
  });

  it("records irrevocable original-requester revocation without exposing cross-account details", async () => {
    const { claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    expect(await store.stage(claim, archive)).toMatchObject(archive);
    expect(await store.revokeForRequester({ ...viewer, actorLogin: "not-owner" })).toBe(false);
    expect(await store.revokeForRequester({ ...viewer, tenantId: "foreign" })).toBe(false);
    expect(await store.revokeForRequester(viewer)).toBe(true);
    expect(await store.revokeForRequester(viewer)).toBe(false);
    const audited = await db().query(
      `SELECT event_type,actor_type,actor_login,metadata
       FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id`,
      [installationId, claim.exportId],
    );
    const events = (audited as { rows: Record<string, unknown>[] }).rows;
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({
      event_type: "data_export.archive.staged",
      actor_type: "system",
      actor_login: null,
      metadata: expect.objectContaining({ sha256: archive.sha256 }),
    });
    expect(events).toContainEqual({
      event_type: "data_export.archive.revoked",
      actor_type: "user",
      actor_login: "original-requester",
      metadata: {},
    });
    expect(JSON.stringify(events)).not.toContain(claim.token);
    expect(await store.readForRequester(viewer)).toBeNull();
    expect(await store.stage(claim, archive)).toBeNull();
  });

  it("does not let the preparer's short lease cut off the original requester's fifteen-minute read window", async () => {
    const { exportId, claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    expect(await store.stage(claim, archive)).toMatchObject(archive);
    await db().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [
      exportId,
    ]);
    expect(await store.stage(claim, archive)).toBeNull();
    expect(await store.readForRequester(viewer)).toMatchObject(archive);
    expect(await store.readForRequester({ ...viewer, actorLogin: "other-requester" })).toBeNull();
    expect(await store.revokeForRequester(viewer)).toBe(true);
    expect(await store.readForRequester(viewer)).toBeNull();
  });

  it("denies expired commitment and lease without auto-reclaim or completing export", async () => {
    const { exportId, claim, viewer } = await claimExport();
    const store = new DataExportArchiveCommitmentStore(db());
    expect(await store.stage(claim, archive)).toMatchObject(archive);
    await db().query(
      "UPDATE data_export_archive_commitments SET expires_at=NOW()-interval '1 second',staged_at=NOW()-interval '20 minutes' WHERE export_id=$1",
      [exportId],
    );
    expect(await store.readForRequester(viewer)).toBeNull();
    expect(await store.stage(claim, archive)).toBeNull();
    await db().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [
      exportId,
    ]);
    expect(await store.readForRequester(viewer)).toBeNull();
    expect(await store.stage(claim, archive)).toBeNull();
  });
});
