import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupExpiredPrivateLocalExportArchive } from "../../apps/web/lib/data-export-archive-cleanup.js";
import { verifyClaimedExportArchiveIntegrity } from "../../apps/web/lib/data-export-archive-integrity.js";
import { runOptInExportArchivePreparationPass } from "../../apps/web/lib/data-export-archive-worker.js";
import { writePrivateExportHttpChunk } from "../../apps/web/lib/data-export-http-chunk.js";
import {
  consumeAuthorizedSealedLocalExportArchive,
  consumeAuthorizedSealedLocalExportArchiveChunks,
  prepareClaimedLocalArchiveZip,
  readAuthorizedSealedLocalExportArchive,
  stageClaimedDurableLocalArchiveCommitment,
  stageClaimedLocalArchiveCommitment,
} from "../../apps/web/lib/data-export-local-archive.js";
import { readSealedLocalExportArchive } from "../../apps/web/lib/data-export-local-archive-storage.js";
import { createAuthorizedSealedLocalExportWebStream } from "../../apps/web/lib/data-export-web-stream.js";
import { DataExportArchiveCommitmentStore } from "../../packages/db/src/data-export-archive-commitment-store.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `postzip-${randomUUID()}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const createdExports: string[] = [];
let storageRoot = "";
let privateArchiveRoot = "";

function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}

async function claimedExport() {
  const claimStore = new DataExportPreparationStore(executor());
  const exportId = await claimStore.createBoundPendingExport({
    tenantId: tenant,
    installationId,
    requestedBy: "original-requester",
    scope: "repository",
    scopeId: repositoryId,
  });
  if (!exportId) throw new Error("Expected an authorized bound export");
  createdExports.push(exportId);
  const claim = await claimStore.claimNext({ installationId, workerId: "postzip-integration" });
  if (!claim || claim.exportId !== exportId) throw new Error("Expected an active lease");
  return {
    exportId,
    claim: {
      exportId,
      tenantId: tenant,
      installationId,
      workerId: claim.workerId,
      token: claim.token,
    },
  };
}

beforeAll(async () => {
  if (!db) return;
  storageRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-postzip-pg-"));
  privateArchiveRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-private-zip-pg-"));
  await chmod(privateArchiveRoot, 0o700);
  await db.query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await db.query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'local-test','main')",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
});

afterAll(async () => {
  if (!db) return;
  try {
    await db.query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [createdExports]);
    // Archive-stage and revoke evidence is append-only. Keep its installation
    // identity until the isolated disposable PostgreSQL database is destroyed.
    // Deleting it here would violate the immutable audit trail contract.
  } finally {
    await db.close();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    if (privateArchiveRoot) await rm(privateArchiveRoot, { recursive: true, force: true });
  }
});

describeDatabase("local export post-packaging PostgreSQL admission", () => {
  it("returns only an internal metadata ZIP with an active installation-bound claim", async () => {
    const { exportId, claim } = await claimedExport();
    const result = await prepareClaimedLocalArchiveZip({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
    });
    expect(result?.files).toBe(8);
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyClaimedExportArchiveIntegrity(result?.bytes ?? Buffer.alloc(0), result?.sha256 ?? "", exportId)).toBe(
      true,
    );
    const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("keeps worker ZIP preparation opt-in, scope-bound, private, and single-claim", async () => {
    const store = new DataExportPreparationStore(executor());
    const exportId = await store.createBoundPendingExport({
      tenantId: tenant,
      installationId,
      requestedBy: "original-requester",
      scope: "repository",
      scopeId: repositoryId,
    });
    if (!exportId) throw new Error("Expected a pending export");
    createdExports.push(exportId);
    const privateRoot = path.join(storageRoot, ".private-export-archives");
    const base = {
      db: executor(),
      workerId: "opt-in-preparation-worker",
      storageDriver: "local",
      storageRoot,
      privateArchiveRoot: privateRoot,
    };
    expect(
      await runOptInExportArchivePreparationPass({
        ...base,
        installationId: undefined,
        privateArchiveRoot: undefined,
      }),
    ).toBe("disabled");
    expect(
      await runOptInExportArchivePreparationPass({
        ...base,
        installationId,
        privateArchiveRoot: path.join(storageRoot, "objects"),
      }),
    ).toBe("invalid_storage");
    const pending = await executor().query("SELECT status,preparation_worker FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((pending as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "pending",
      preparation_worker: null,
    });

    expect(await runOptInExportArchivePreparationPass({ ...base, installationId })).toBe("staged");
    const record = await new DataExportArchiveCommitmentStore(executor()).readForRequester({
      exportId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    });
    expect(record).not.toBeNull();
    const dir = await lstat(privateRoot);
    expect(dir.mode & 0o077).toBe(0);
    const ZIP = await readSealedLocalExportArchive({
      archiveRoot: privateRoot,
      exportId,
      sha256: record?.sha256 ?? "",
      byteLength: record?.byteLength ?? 0,
    });
    expect(ZIP).not.toBeNull();
    const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
    expect(await runOptInExportArchivePreparationPass({ ...base, installationId })).toBe("idle");
  });

  it("purges only a revoked claim-bound ZIP after a cross-scope legal hold is released", async () => {
    const { exportId, claim } = await claimedExport();
    const cleanupRoot = path.join(storageRoot, ".private-export-archives");
    await mkdir(cleanupRoot, { recursive: true, mode: 0o700 });
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot: cleanupRoot,
    });
    if (!staged) throw new Error("Expected sealed archive");
    const candidate = { db: executor(), archiveRoot: cleanupRoot, exportId, tenantId: tenant, installationId };
    const store = new DataExportArchiveCommitmentStore(executor());
    expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("active");
    expect(await cleanupExpiredPrivateLocalExportArchive({ ...candidate, tenantId: "unrelated" })).toBe("unknown");
    const holdId = randomUUID();
    try {
      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'integration','preserve independent repository evidence','repository',$3)",
        [holdId, tenant.toUpperCase(), randomUUID()],
      );
      expect(
        await store.revokeForRequester({
          exportId,
          tenantId: tenant,
          installationId,
          actorLogin: "original-requester",
        }),
      ).toBe(true);
      expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("hold");
      expect((await lstat(path.join(cleanupRoot, exportId.concat(".zip")))).isFile()).toBe(true);
      await executor().query(
        "UPDATE legal_holds SET active=FALSE,released_at=NOW(),released_by='integration' WHERE id=$1",
        [holdId],
      );
      expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("deleted");
      await expect(lstat(path.join(cleanupRoot, exportId.concat(".zip")))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("cleaned");
      expect(await store.previewRetention({ exportId, tenantId: tenant, installationId })).toBe("cleaned");
      expect(
        await store.readForRequester({
          exportId,
          tenantId: tenant,
          installationId,
          actorLogin: "original-requester",
        }),
      ).toBeNull();
      const evidence = await executor().query(
        "SELECT event_type,metadata FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
        [installationId, exportId],
      );
      const rows = (evidence as { rows: Array<{ event_type: string; metadata: Record<string, unknown> }> }).rows;
      expect(rows.map((entry) => entry.event_type)).toEqual([
        "data_export.archive.staged",
        "data_export.archive.revoked",
        "data_export.archive.cleaned",
      ]);
      expect(rows.at(-1)?.metadata).toEqual({ outcome: "deleted", sha256: staged.sha256 });
      const dbRow = await executor().query(
        "SELECT cleaned_at,cleanup_result,archive_sha256 FROM data_export_archive_commitments WHERE export_id=$1",
        [exportId],
      );
      expect((dbRow as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({
        cleaned_at: expect.any(Date),
        cleanup_result: "deleted",
        archive_sha256: staged.sha256,
      });
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
  });

  it("keeps unbound orphan and tampered bytes quarantined, but audits a missing previously committed ZIP", async () => {
    const cleanupRoot = path.join(storageRoot, ".private-export-archives");
    await mkdir(cleanupRoot, { recursive: true, mode: 0o700 });
    const unknownId = randomUUID();
    const orphanPath = path.join(cleanupRoot, unknownId.concat(".zip"));
    await writeFile(orphanPath, "orphan with unknown owner", { mode: 0o600 });
    expect(
      await cleanupExpiredPrivateLocalExportArchive({
        db: executor(),
        archiveRoot: cleanupRoot,
        exportId: unknownId,
        tenantId: tenant,
        installationId,
      }),
    ).toBe("unknown");
    expect((await lstat(orphanPath)).isFile()).toBe(true);

    const { exportId: tamperedId, claim: tamperedClaim } = await claimedExport();
    const tampered = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim: tamperedClaim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot: cleanupRoot,
    });
    if (!tampered) throw new Error("Expected sealed archive");
    const store = new DataExportArchiveCommitmentStore(executor());
    await store.revokeForRequester({
      exportId: tamperedId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    });
    const tamperedPath = path.join(cleanupRoot, tamperedId.concat(".zip"));
    await writeFile(tamperedPath, Buffer.alloc(tampered.byteLength));
    expect(
      await cleanupExpiredPrivateLocalExportArchive({
        db: executor(),
        archiveRoot: cleanupRoot,
        exportId: tamperedId,
        tenantId: tenant,
        installationId,
      }),
    ).toBe("quarantined");
    expect((await lstat(tamperedPath)).isFile()).toBe(true);
    const fresh = await executor().query("SELECT cleaned_at FROM data_export_archive_commitments WHERE export_id=$1", [
      tamperedId,
    ]);
    expect((fresh as { rows: unknown[] }).rows[0]).toEqual({ cleaned_at: null });

    const { exportId: missingId, claim: missingClaim } = await claimedExport();
    const sealed = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim: missingClaim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot: cleanupRoot,
    });
    if (!sealed) throw new Error("Expected sealed archive");
    await store.revokeForRequester({
      exportId: missingId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    });
    await unlink(path.join(cleanupRoot, missingId.concat(".zip")));
    expect(
      await cleanupExpiredPrivateLocalExportArchive({
        db: executor(),
        archiveRoot: cleanupRoot,
        exportId: missingId,
        tenantId: tenant,
        installationId,
      }),
    ).toBe("missing");
    const evidence = await executor().query(
      "SELECT event_type,metadata FROM audit_events WHERE installation_id=$1 AND subject_id=$2 AND event_type='data_export.archive.cleaned'",
      [installationId, missingId],
    );
    expect((evidence as { rows: unknown[] }).rows).toEqual([
      {
        event_type: "data_export.archive.cleaned",
        metadata: { outcome: "missing", sha256: sealed.sha256 },
      },
    ]);
  });

  it("recovers a deleted file as audited missing bytes after a failed database cleanup commit", async () => {
    const cleanupRoot = path.join(storageRoot, ".private-export-archives");
    await mkdir(cleanupRoot, { recursive: true, mode: 0o700 });
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot: cleanupRoot,
    });
    if (!staged) throw new Error("Expected staged ZIP");
    expect(
      await new DataExportArchiveCommitmentStore(executor()).revokeForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "original-requester",
      }),
    ).toBe(true);
    const request = { archiveRoot: cleanupRoot, exportId, tenantId: tenant, installationId };
    const failingDb = {
      withTransaction: async <T>(
        work: (tx: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> }) => Promise<T>,
      ) =>
        executor().withTransaction(async (tx) =>
          work({
            query: async (sql, params) => {
              if (sql.startsWith("WITH cleaned AS")) throw new Error("simulated audit persistence failure");
              return tx.query(sql, params);
            },
          }),
        ),
    };
    await expect(cleanupExpiredPrivateLocalExportArchive({ ...request, db: failingDb as never })).rejects.toThrow(
      "simulated audit persistence failure",
    );
    await expect(lstat(path.join(cleanupRoot, exportId.concat(".zip")))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const afterCrash = await executor().query(
      "SELECT cleaned_at FROM data_export_archive_commitments WHERE export_id=$1",
      [exportId],
    );
    expect((afterCrash as { rows: unknown[] }).rows).toEqual([{ cleaned_at: null }]);
    expect(await cleanupExpiredPrivateLocalExportArchive({ ...request, db: executor() })).toBe("missing");
    const events = await executor().query(
      "SELECT event_type,metadata FROM audit_events WHERE installation_id=$1 AND subject_id=$2 AND event_type='data_export.archive.cleaned'",
      [installationId, exportId],
    );
    expect((events as { rows: unknown[] }).rows).toEqual([
      {
        event_type: "data_export.archive.cleaned",
        metadata: { outcome: "missing", sha256: staged.sha256 },
      },
    ]);
  });

  it("fails closed while another transaction writes an active legal hold", async () => {
    const cleanupRoot = path.join(storageRoot, ".private-export-archives");
    await mkdir(cleanupRoot, { recursive: true, mode: 0o700 });
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot: cleanupRoot,
    });
    if (!staged) throw new Error("Expected staged archive");
    expect(
      await new DataExportArchiveCommitmentStore(executor()).revokeForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "original-requester",
      }),
    ).toBe(true);
    const candidate = { db: executor(), archiveRoot: cleanupRoot, exportId, tenantId: tenant, installationId };
    const holdId = randomUUID();
    let signalHeld: () => void = () => {};
    let releaseHold: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const blocking = executor().withTransaction(
      async (tx) => {
        await tx.query(
          "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope) VALUES($1,$2,'integration','concurrent cleanup hold','organization')",
          [holdId, tenant],
        );
        signalHeld();
        await released;
      },
      { statementTimeoutMs: 5000 },
    );
    try {
      await held;
      expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("busy");
      expect((await lstat(path.join(cleanupRoot, exportId.concat(".zip")))).isFile()).toBe(true);
    } finally {
      releaseHold();
      await blocking;
    }
    try {
      expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("hold");
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
    expect(await cleanupExpiredPrivateLocalExportArchive(candidate)).toBe("deleted");
  });

  it("commits only the verified in-memory ZIP while leaving customer delivery disabled", async () => {
    const { exportId, claim } = await claimedExport();
    const published = await stageClaimedLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
    });
    expect(published?.archive.files).toBe(8);
    expect(published?.expiresAt).toMatch(/Z$/u);
    const store = new DataExportArchiveCommitmentStore(executor());
    const viewed = await store.readForRequester({
      exportId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    });
    expect(viewed).toMatchObject({
      sha256: published?.archive.sha256,
      byteLength: published?.archive.byteLength,
      files: 8,
    });
    expect(
      await store.readForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "other-requester",
      }),
    ).toBeNull();
    expect(
      await new DataExportPreparationStore(executor()).releaseReadOnlyClaim({
        exportId,
        installationId,
        workerId: claim.workerId,
        token: claim.token,
      }),
    ).toBe(false);
    expect(
      await stageClaimedLocalArchiveCommitment({
        db: executor(),
        claim,
        storageRoot,
        storageDriver: "local",
      }),
    ).toBeNull();
    const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("seals verified ZIP bytes BEFORE an immutable database commitment without enabling download", async () => {
    const { exportId, claim } = await claimedExport();
    const input = {
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    };
    const sealed = await stageClaimedDurableLocalArchiveCommitment(input);
    expect(sealed).toMatchObject({ files: 8, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    if (!sealed) throw new Error("Expected durable internal archive commitment");
    const bytes = await readSealedLocalExportArchive({
      archiveRoot: privateArchiveRoot,
      exportId,
      sha256: sealed.sha256,
      byteLength: sealed.byteLength,
    });
    expect(bytes).not.toBeNull();
    expect(verifyClaimedExportArchiveIntegrity(bytes ?? Buffer.alloc(0), sealed.sha256, exportId)).toBe(true);
    const authorized = {
      db: executor(),
      archiveRoot: privateArchiveRoot,
      exportId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    };
    expect(await readAuthorizedSealedLocalExportArchive(authorized)).toEqual(bytes);
    const reads = await executor().query(
      "SELECT event_type,actor_type,actor_login,metadata FROM audit_events WHERE installation_id=$1 AND subject_id=$2 AND event_type='data_export.archive.read_verified'",
      [installationId, exportId],
    );
    expect((reads as { rows: unknown[] }).rows).toEqual([
      {
        event_type: "data_export.archive.read_verified",
        actor_type: "user",
        actor_login: "original-requester",
        metadata: {
          sha256: sealed.sha256,
          byteLength: sealed.byteLength,
          fileCount: sealed.files,
        },
      },
    ]);
    expect(await readAuthorizedSealedLocalExportArchive({ ...authorized, actorLogin: "other-requester" })).toBeNull();
    expect(await readAuthorizedSealedLocalExportArchive({ ...authorized, tenantId: "foreign-tenant" })).toBeNull();
    const store = new DataExportArchiveCommitmentStore(executor());
    expect(
      await store.readForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "original-requester",
      }),
    ).toMatchObject(sealed);
    expect(await stageClaimedDurableLocalArchiveCommitment(input)).toBeNull();
    const lifecycle = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((lifecycle as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
    // A local file is neither proof of current access nor a download URL.
    expect(
      await store.revokeForRequester({ exportId, tenantId: tenant, installationId, actorLogin: "original-requester" }),
    ).toBe(true);
    expect(
      await store.readForRequester({ exportId, tenantId: tenant, installationId, actorLogin: "original-requester" }),
    ).toBeNull();
    expect(await readAuthorizedSealedLocalExportArchive(authorized)).toBeNull();
    const target = path.join(privateArchiveRoot, `${exportId}.zip`);
    await writeFile(target, Buffer.alloc(sealed.byteLength));
    expect(
      await readSealedLocalExportArchive({
        archiveRoot: privateArchiveRoot,
        exportId,
        sha256: sealed.sha256,
        byteLength: sealed.byteLength,
      }),
    ).toBeNull();
  });

  it("holds the commitment revocation fence through bounded internal ZIP consumption", async () => {
    const { exportId, claim } = await claimedExport();
    const sealed = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    expect(sealed).not.toBeNull();
    if (!sealed) throw new Error("Expected committed private ZIP");

    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    let signalTransfer: () => void = () => {};
    const transferStarted = new Promise<void>((resolve) => {
      signalTransfer = resolve;
    });
    let finishTransfer: () => void = () => {};
    const transferCompleted = new Promise<void>((resolve) => {
      finishTransfer = resolve;
    });
    let observedBytes: Buffer | undefined;
    const transfer = consumeAuthorizedSealedLocalExportArchive(
      { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
      async (bytes) => {
        observedBytes = bytes;
        signalTransfer();
        await transferCompleted;
      },
    );
    try {
      await transferStarted;
      const revoke = new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester);
      const earlier = await Promise.race([
        revoke.then(() => "revoked" as const),
        new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 150)),
      ]);
      expect(earlier).toBe("waiting");
      finishTransfer();
      expect(await transfer).toBe(true);
      expect(await revoke).toBe(true);
      expect(observedBytes).toBeInstanceOf(Buffer);
      expect(verifyClaimedExportArchiveIntegrity(observedBytes ?? Buffer.alloc(0), sealed.sha256, exportId)).toBe(true);
      expect(
        await consumeAuthorizedSealedLocalExportArchive(
          { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
          async () => {
            throw new Error("Revoked ZIP must not be consumed");
          },
        ),
      ).toBe(false);
      const audit = await executor().query(
        "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
        [installationId, exportId],
      );
      expect((audit as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
        "data_export.archive.staged",
        "data_export.archive.read_verified",
        "data_export.archive.revoked",
      ]);
    } finally {
      finishTransfer();
      await transfer.catch(() => {});
    }
  });

  it("rolls back verified-read audit if bounded transfer consumption fails", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    expect(staged).not.toBeNull();
    await expect(
      consumeAuthorizedSealedLocalExportArchive(
        {
          db: executor(),
          archiveRoot: privateArchiveRoot,
          exportId,
          tenantId: tenant,
          installationId,
          actorLogin: "original-requester",
        },
        async () => {
          throw new Error("simulated transfer abort");
        },
      ),
    ).rejects.toThrow("simulated transfer abort");
    const audit = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2",
      [installationId, exportId],
    );
    expect((audit as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
    expect(
      await new DataExportArchiveCommitmentStore(executor()).readForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "original-requester",
      }),
    ).not.toBeNull();
  });

  it("consumes private ZIP in backpressured chunks, matching its independent SHA-256", async () => {
    const { exportId, claim } = await claimedExport();
    const sealed = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!sealed) throw new Error("Expected ZIP commitment");
    const digest = createHash("sha256");
    let chunkCount = 0;
    let totalBytes = 0;
    const succeeded = await consumeAuthorizedSealedLocalExportArchiveChunks(
      {
        db: executor(),
        archiveRoot: privateArchiveRoot,
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: "original-requester",
      },
      async (chunk) => {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(16 * 1024);
        chunkCount++;
        totalBytes += chunk.byteLength;
        await Promise.resolve(); // Acknowledged write/backpressure.
        digest.update(chunk);
      },
    );
    expect(succeeded).toBe(true);
    expect(chunkCount).toBeGreaterThan(0);
    expect(totalBytes).toBe(sealed.byteLength);
    expect(digest.digest("hex")).toBe(sealed.sha256);
  });

  it("rolls back verified-read audit and releases the fence on transport abort", async () => {
    const { exportId, claim } = await claimedExport();
    const sealed = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!sealed) throw new Error("Expected ZIP commitment");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    const controller = new AbortController();
    let chunks = 0;
    await expect(
      consumeAuthorizedSealedLocalExportArchiveChunks(
        { ...requester, db: executor(), archiveRoot: privateArchiveRoot, signal: controller.signal },
        async () => {
          chunks++;
          controller.abort();
        },
      ),
    ).rejects.toThrow("ZIP transfer aborted");
    expect(chunks).toBe(1);
    const evidence = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
      [installationId, exportId],
    );
    expect((evidence as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
    expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
    expect(
      await consumeAuthorizedSealedLocalExportArchiveChunks(
        { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
        async () => {
          throw new Error("Revoked ZIP should never be delivered");
        },
      ),
    ).toBe(false);
    await expect(
      consumeAuthorizedSealedLocalExportArchiveChunks(
        { ...requester, db: executor(), archiveRoot: privateArchiveRoot, signal: controller.signal },
        async () => {
          throw new Error("Aborted ZIP should never be delivered");
        },
      ),
    ).rejects.toThrow("ZIP transfer aborted");
  });

  it.each(["received", "disconnected"] as const)(
    "delivers a private Web Streams Response through a real localhost HTTP socket: %s",
    async (scenario) => {
      const { exportId, claim } = await claimedExport();
      const staged = await stageClaimedDurableLocalArchiveCommitment({
        db: executor(),
        claim,
        storageRoot,
        storageDriver: "local",
        privateArchiveRoot,
      });
      if (!staged) throw new Error("Expected sealed private ZIP");
      const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
      let finishTransport: (result: string) => void = () => {};
      const transportFinished = new Promise<string>((resolve) => {
        finishTransport = resolve;
      });
      let finishDatabase: (result: boolean) => void = () => {};
      const databaseFinished = new Promise<boolean>((resolve) => {
        finishDatabase = resolve;
      });
      const server = createServer((_request, response) => {
        const controller = new AbortController();
        let destroyed = false;
        response.once("close", () => {
          if (!response.writableFinished) {
            destroyed = true;
            controller.abort();
          }
        });
        const { body, completed } = createAuthorizedSealedLocalExportWebStream({
          ...requester,
          db: executor(),
          archiveRoot: privateArchiveRoot,
          signal: controller.signal,
        });
        const webResponse = new Response(body, {
          headers: {
            "content-type": "application/zip",
            "content-length": String(staged.byteLength),
            "cache-control": "private, no-store",
          },
        });
        void completed.then(finishDatabase, () => finishDatabase(false));
        void (async () => {
          const reader = webResponse.body?.getReader();
          if (!reader) throw new Error("Missing HTTP response body");
          let sent = 0;
          try {
            response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              if (destroyed || controller.signal.aborted) throw new Error("Disconnected");
              response.write(Buffer.from(next.value));
              sent++;
              if (scenario === "disconnected" && sent === 1) {
                await new Promise<void>((resolve) => response.once("close", resolve));
                throw new Error("Client closed after first chunk");
              }
            }
            if (!destroyed) {
              response.end();
              finishTransport("sent");
            } else {
              finishTransport("disconnected");
            }
          } catch {
            await reader.cancel("HTTP client disconnected").catch(() => {});
            response.destroy();
            finishTransport("disconnected");
          } finally {
            reader.releaseLock();
          }
        })().catch(() => finishTransport("failed"));
      });
      try {
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address() as AddressInfo;
        const actual = await new Promise<Buffer>((resolve, reject) => {
          const request = get(`http://127.0.0.1:${address.port}/archive-fixture`, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
              if (scenario === "disconnected") {
                response.destroy();
                resolve(Buffer.concat(chunks));
              }
            });
            response.once("end", () => resolve(Buffer.concat(chunks)));
            response.once("error", (error) => {
              if (scenario === "disconnected" && chunks.length > 0) return;
              reject(error);
            });
          });
          request.once("error", reject);
        });
        const transportOutcome = await transportFinished;
        const dbOutcome = await databaseFinished;
        if (scenario === "received") {
          expect(transportOutcome).toBe("sent");
          expect(dbOutcome).toBe(true);
          expect(actual.byteLength).toBe(staged.byteLength);
          expect(createHash("sha256").update(actual).digest("hex")).toBe(staged.sha256);
        } else {
          expect(transportOutcome).toBe("disconnected");
          expect(dbOutcome).toBe(false);
          expect(actual.byteLength).toBeLessThan(staged.byteLength);
        }
        const evidence = await executor().query(
          "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
          [installationId, exportId],
        );
        expect((evidence as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual(
          scenario === "received"
            ? ["data_export.archive.staged", "data_export.archive.read_verified"]
            : ["data_export.archive.staged"],
        );
        expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    10_000,
  );

  it("rolls back audited ZIP read when a real localhost HTTP client disconnects", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected a sealed private ZIP");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    let finishTransfer: (result: string) => void = () => {};
    const transferFinished = new Promise<string>((resolve) => {
      finishTransfer = resolve;
    });
    const server = createServer((_request, response) => {
      const controller = new AbortController();
      response.once("close", () => controller.abort());
      void (async () => {
        let first = true;
        try {
          await consumeAuthorizedSealedLocalExportArchiveChunks(
            { ...requester, db: executor(), archiveRoot: privateArchiveRoot, signal: controller.signal },
            async (chunk) => {
              const closed = new Promise<void>((resolve) => response.once("close", () => resolve()));
              await writePrivateExportHttpChunk(response, chunk, controller.signal);
              if (first) {
                first = false;
                // Simulate a slow HTTP sink after its first acknowledged chunk.
                // The real peer destroys the socket while the DB lock is held.
                await closed;
              }
            },
          );
          finishTransfer("unexpected success");
        } catch {
          finishTransfer("cancelled");
        } finally {
          response.destroy();
        }
      })();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      await new Promise<void>((resolve, reject) => {
        const request = get(`http://127.0.0.1:${address.port}/private-test`, (response) => {
          response.once("data", () => {
            response.destroy();
            resolve();
          });
          response.once("error", () => {});
        });
        request.once("error", reject);
      });
      expect(await transferFinished).toBe("cancelled");
      const audit = await executor().query(
        "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
        [installationId, exportId],
      );
      expect((audit as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
        "data_export.archive.staged",
      ]);
      expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
      expect(await new DataExportArchiveCommitmentStore(executor()).readForRequester(requester)).toBeNull();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8000);

  it("keeps the PostgreSQL revocation fence held until the HTTP finish callback completes", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected ZIP commitment");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    let notifyFinishing: () => void = () => {};
    let releaseFinish: () => void = () => {};
    const finishing = new Promise<void>((resolve) => {
      notifyFinishing = resolve;
    });
    const responseFinished = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const transfer = consumeAuthorizedSealedLocalExportArchiveChunks(
      { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
      async (_chunk) => {},
      async () => {
        notifyFinishing();
        await responseFinished;
      },
    );
    let revoke: Promise<boolean> | undefined;
    try {
      await finishing;
      revoke = new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester);
      const outcome = await Promise.race([
        revoke.then(() => "revoked" as const),
        new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 150)),
      ]);
      expect(outcome).toBe("waiting");
    } finally {
      releaseFinish();
    }
    expect(await transfer).toBe(true);
    expect(await revoke).toBe(true);
    const audit = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
      [installationId, exportId],
    );
    expect((audit as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
      "data_export.archive.read_verified",
      "data_export.archive.revoked",
    ]);
  });

  it("rolls back read audit if all HTTP chunks flush but response finish fails", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected ZIP commitment");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    let chunks = 0;
    await expect(
      consumeAuthorizedSealedLocalExportArchiveChunks(
        { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
        async () => {
          chunks++;
        },
        async () => {
          throw new Error("HTTP finish disconnected");
        },
      ),
    ).rejects.toThrow("HTTP finish disconnected");
    expect(chunks).toBeGreaterThan(0);
    const audit = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2",
      [installationId, exportId],
    );
    expect((audit as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
    expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
  });

  it("adapts private ZIP to pull-driven Web Streams without losing digest or revocation fencing", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected sealed private ZIP");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    const { body, completed } = createAuthorizedSealedLocalExportWebStream({
      ...requester,
      db: executor(),
      archiveRoot: privateArchiveRoot,
    });
    const response = new Response(body, { headers: { "content-type": "application/zip" } });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected Response body");
    expect(staged.byteLength).toBeGreaterThan(1024);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);
    const revoke = new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester);
    const early = await Promise.race([
      revoke.then(() => "revoked" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 150)),
    ]);
    expect(early).toBe("waiting");
    const digest = createHash("sha256");
    let length = 0;
    if (first.value) {
      digest.update(first.value);
      length += first.value.byteLength;
    }
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      digest.update(next.value);
      length += next.value.byteLength;
    }
    expect(await completed).toBe(true);
    expect(length).toBe(staged.byteLength);
    expect(digest.digest("hex")).toBe(staged.sha256);
    expect(await revoke).toBe(true);
  });

  it("rolls back private ZIP read audit when Web Streams consumer cancels mid-read", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected private ZIP");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    const { body, completed } = createAuthorizedSealedLocalExportWebStream({
      ...requester,
      db: executor(),
      archiveRoot: privateArchiveRoot,
    });
    const reader = body.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel("client disconnected");
    expect(await completed).toBe(false);
    const events = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2",
      [installationId, exportId],
    );
    expect((events as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
    expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
  });

  it("ends an unread Web Streams response by its bounded deadline and releases revocation fence", async () => {
    const { exportId, claim } = await claimedExport();
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    if (!staged) throw new Error("Expected sealed ZIP");
    const requester = { exportId, tenantId: tenant, installationId, actorLogin: "original-requester" };
    const { body, completed } = createAuthorizedSealedLocalExportWebStream(
      { ...requester, db: executor(), archiveRoot: privateArchiveRoot },
      50,
    );
    // Keep the reader idle: no pull or cancellation acknowledgement arrives.
    const response = new Response(body, { status: 200 });
    expect(response.body).not.toBeNull();
    const result = await Promise.race([
      completed,
      new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 1_000)),
    ]);
    expect(result).toBe(false);
    const events = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2",
      [installationId, exportId],
    );
    expect((events as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
    expect(await new DataExportArchiveCommitmentStore(executor()).revokeForRequester(requester)).toBe(true);
    await response.body?.cancel().catch(() => {});
  }, 4000);

  it("fails closed when the original requester revokes during local file IO", async () => {
    const { exportId, claim } = await claimedExport();
    const sealed = await stageClaimedDurableLocalArchiveCommitment({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
      privateArchiveRoot,
    });
    expect(sealed).not.toBeNull();
    let reads = 0;
    const racedDb = {
      async query(sql: string, params?: readonly unknown[]) {
        if (sql.includes("FROM data_export_archive_commitments AS commitment")) {
          reads++;
          if (reads === 2) {
            await new DataExportArchiveCommitmentStore(executor()).revokeForRequester({
              exportId,
              tenantId: tenant,
              installationId,
              actorLogin: "original-requester",
            });
          }
        }
        return await executor().query(sql, params);
      },
    };
    const result = await readAuthorizedSealedLocalExportArchive({
      db: racedDb,
      archiveRoot: privateArchiveRoot,
      exportId,
      tenantId: tenant,
      installationId,
      actorLogin: "original-requester",
    });
    expect(reads).toBe(2);
    expect(result).toBeNull();
    const readAudit = await executor().query(
      "SELECT id FROM audit_events WHERE installation_id=$1 AND subject_id=$2 AND event_type='data_export.archive.read_verified'",
      [installationId, exportId],
    );
    expect((readAudit as { rows: unknown[] }).rows).toHaveLength(0);
    const row = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((row as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("fails closed on a nonprivate export root before writing DB commitment", async () => {
    const { exportId, claim } = await claimedExport();
    await chmod(privateArchiveRoot, 0o750);
    try {
      expect(
        await stageClaimedDurableLocalArchiveCommitment({
          db: executor(),
          claim,
          storageRoot,
          storageDriver: "local",
          privateArchiveRoot,
        }),
      ).toBeNull();
      const results = await executor().query(
        "SELECT archive_sha256 FROM data_export_archive_commitments WHERE export_id=$1",
        [exportId],
      );
      expect((results as { rows: unknown[] }).rows).toHaveLength(0);
    } finally {
      await chmod(privateArchiveRoot, 0o700);
    }
  });

  it.each(["installation-suspended", "lease-expired"] as const)(
    "rejects an internally packed ZIP when %s before final authorization",
    async (change) => {
      const { exportId, claim } = await claimedExport();
      let manifestReads = 0;
      const wrapped = {
        ...executor(),
        async query(sql: string, params?: readonly unknown[]) {
          if (sql.includes("WITH allowed_request AS MATERIALIZED")) {
            manifestReads += 1;
            if (manifestReads === 2) {
              if (change === "installation-suspended") {
                await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
              } else {
                await executor().query(
                  "UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1",
                  [exportId],
                );
              }
            }
          }
          return await executor().query(sql, params);
        },
      };
      try {
        const result = await prepareClaimedLocalArchiveZip({
          db: wrapped,
          claim,
          storageRoot,
          storageDriver: "local",
        });
        expect(manifestReads).toBe(2);
        expect(result).toBeNull();
        const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
          exportId,
        ]);
        expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
          status: "running",
          download_url: null,
          completed_at: null,
        });
      } finally {
        if (change === "installation-suspended") {
          await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
        }
      }
    },
  );
});
