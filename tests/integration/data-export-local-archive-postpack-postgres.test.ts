import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyClaimedExportArchiveIntegrity } from "../../apps/web/lib/data-export-archive-integrity.js";
import {
  prepareClaimedLocalArchiveZip,
  stageClaimedDurableLocalArchiveCommitment,
  stageClaimedLocalArchiveCommitment,
} from "../../apps/web/lib/data-export-local-archive.js";
import { readSealedLocalExportArchive } from "../../apps/web/lib/data-export-local-archive-storage.js";
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
    await db.query("DELETE FROM installations WHERE id=$1", [installationId]);
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
