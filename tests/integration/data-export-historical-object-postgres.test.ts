import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HistoricalUserArchivePreflightError,
  prepareVerifiedHistoricalUserMetadataOnlyArchive,
  prepareVerifiedHistoricalUserPartialArchive,
  verifyHistoricalUserMetadataOnlyArchive,
  verifyHistoricalUserPartialArchive,
} from "../../apps/web/lib/data-export-historical-archive.js";
import { assessHistoricalUserMetadataExposure } from "../../apps/web/lib/data-export-historical-metadata-exposure.js";
import { readVerifiedHistoricalUserLocalObject } from "../../apps/web/lib/data-export-historical-object.js";
import {
  prepareSealedHistoricalUserPrivatePartial,
  readSealedHistoricalUserPartial,
  sealHistoricalUserPrivatePartial,
} from "../../apps/web/lib/data-export-historical-partial-storage.js";
import {
  inspectVerifiedHistoricalUserPrivateArchivePreflight,
  stageVerifiedHistoricalUserPrivateArchivePreflight,
} from "../../apps/web/lib/data-export-historical-private-preflight.js";
import { writePrivateExportHttpChunk } from "../../apps/web/lib/data-export-http-chunk.js";
import { ensurePrivateLocalExportArchiveDirectory } from "../../apps/web/lib/data-export-local-archive-storage.js";
import { sanitizeAndExtractArchive } from "../../packages/cloud-core/src/archive-sanitizer.js";
import { createSqlArtifactDeletionStore } from "../../packages/db/src/artifact-deletion-store.js";
import {
  prepareVerifiedHistoricalUserCompositePreflight,
  prepareVerifiedHistoricalUserConsistentCorePreflight,
} from "../../packages/db/src/data-export-historical-inventory.js";
import {
  checkHistoricalUserArchivePrepublication,
  lookupHistoricalUserExportObject,
  releaseHistoricalUserObjectBatch,
  releaseHistoricalUserObjectCopy,
  reserveHistoricalUserObjectBatch,
  reserveHistoricalUserObjectCopy,
} from "../../packages/db/src/data-export-historical-object-authorization.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : null;
const installationId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const artifactId = randomUUID();
const exportId = randomUUID();
const tenant = ["historical-reader", randomUUID()].join("-");
const githubUserId = 9_876_543_210;
const contents = Buffer.from("historical-integrity-verification-private-fixture", "utf8");
const digest = createHash("sha256").update(contents).digest("hex");
const objectPath = ["artifacts", `${randomUUID()}.bin`].join("/");
const authority = { exportId, verifiedGitHubUserId: githubUserId };
let storageRoot = "";

function executor() {
  if (!db) throw new Error("Isolated PostgreSQL required");
  return db;
}

async function read() {
  return readVerifiedHistoricalUserLocalObject({
    db: executor(),
    authority,
    artifactId,
    storageRoot,
    storageDriver: "local",
  });
}

async function rows(sql: string, args: unknown[] = []) {
  const result = await executor().query(sql, args);
  return (result as { rows?: Record<string, unknown>[] }).rows ?? [];
}

beforeAll(async () => {
  if (!db) return;
  storageRoot = await mkdtemp(join(tmpdir(), "bro-history-"));
  await mkdir(join(storageRoot, "artifacts"), { recursive: true });
  await writeFile(join(storageRoot, objectPath), contents);
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant, githubUserId],
  );
  await executor().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at) VALUES($1,$2,$3,$4,'retained-private','main',NOW())",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await executor().query(
    "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
    [runId, repositoryId, "a".repeat(40)],
  );
  await executor().query(
    "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until) VALUES($1,$2,'manufacturing','private.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')",
    [artifactId, runId, objectPath, digest, contents.length],
  );
  await executor().query(
    "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id) VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)",
    [exportId, tenant, githubUserId],
  );
});

afterAll(async () => {
  if (!db) return;
  try {
    await executor().query("DELETE FROM artifact_export_copy_reservations WHERE export_id=$1", [exportId]);
    await executor().query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await executor().query("DELETE FROM erasure_requests WHERE tenant_id=$1", [tenant]);
    await executor().query("DELETE FROM installations WHERE id=$1", [installationId]);
  } finally {
    await db.close();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  }
});

describeDb("historical original-USER physical artifact preflight", () => {
  it("reads genuine retained bytes, verifies SHA-256, and settles a durable reservation", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    expect(object).toMatchObject({
      artifactId,
      repositoryId,
      runId,
      storagePath: objectPath,
      sha256: digest,
      byteLength: contents.length,
    });
    const verified = await read();
    expect(verified).toMatchObject({ artifactId, sha256: digest });
    expect(verified?.bytes.equals(contents)).toBe(true);
    const reservations = await rows(
      "SELECT released_at,storage_path FROM artifact_export_copy_reservations WHERE export_id=$1",
      [exportId],
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.released_at).toBeInstanceOf(Date);
    expect(reservations[0]?.storage_path).toBe(objectPath);
    expect(
      await readVerifiedHistoricalUserLocalObject({
        db: executor(),
        authority,
        artifactId,
        storageRoot,
        storageDriver: "r2",
      }),
    ).toBeNull();
  });

  it("prepares a separate original-USER metadata-only ZIP for a REAL retained artifact without file bytes", async () => {
    const diagnostic = await prepareVerifiedHistoricalUserMetadataOnlyArchive({
      db: executor(),
      authority,
    });
    expect(diagnostic).not.toBeNull();
    if (!diagnostic) throw new Error("Missing metadata-only fixture");
    expect(diagnostic.files).toBe(3);
    expect(verifyHistoricalUserMetadataOnlyArchive(diagnostic.bytes, diagnostic.sha256, exportId)).toBe(true);
    const entries = sanitizeAndExtractArchive(diagnostic.bytes).files;
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.path.startsWith("metadata/"))).toBe(true);
    expect(entries.some((entry) => entry.path.startsWith("objects/"))).toBe(false);
    expect(diagnostic.bytes.includes(contents)).toBe(false);
    const receiptBytes = entries.find(
      (entry) => entry.path === "metadata/historical-metadata-only-integrity.json",
    )?.data;
    const receipt = JSON.parse(receiptBytes?.toString("utf8") ?? "{}");
    expect(receipt).toMatchObject({
      artifactDescriptorCount: 1,
      physicalArtifactContentsIncluded: false,
      privateVisualContentsIncluded: false,
      completeCustomerExport: false,
      customerDeliveryReady: false,
    });
    const exposure = assessHistoricalUserMetadataExposure({
      archiveBytes: diagnostic.bytes,
      exportId,
    });
    expect(exposure?.customerDeliveryReady).toBe(false);
    expect(exposure?.physicalArtifactBytesIncluded).toBe(false);
    expect(exposure?.exposure).toEqual(
      expect.arrayContaining([
        { category: "artifact_content_hash", rows: 1, rightsVerified: false },
        { category: "artifact_size", rows: 1, rightsVerified: false },
        { category: "commit_hash", rows: 1, rightsVerified: false },
      ]),
    );
    expect(JSON.stringify(exposure)).not.toContain(artifactId);
    expect(JSON.stringify(exposure)).not.toContain(repositoryId);
    expect(JSON.stringify(exposure)).not.toContain(digest);
    expect(JSON.stringify(exposure)).not.toContain(tenant);
    expect(
      await prepareVerifiedHistoricalUserMetadataOnlyArchive({
        db: executor(),
        authority: { ...authority, verifiedGitHubUserId: githubUserId + 1 },
      }),
    ).toBeNull();
  });

  it("denies private metadata-only archive under active hold, revoked export, erasure or expiring retention", async () => {
    const holdId = randomUUID();
    const erasureId = randomUUID();
    try {
      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'system','Temporary fixture hold','user',$2)",
        [holdId, tenant],
      );
      expect(
        await prepareVerifiedHistoricalUserMetadataOnlyArchive({
          db: executor(),
          authority,
        }),
      ).toBeNull();
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);

      await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
      expect(
        await prepareVerifiedHistoricalUserMetadataOnlyArchive({
          db: executor(),
          authority,
        }),
      ).toBeNull();
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);

      await executor().query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'system','repository',$3,'running',FALSE)",
        [erasureId, tenant, repositoryId],
      );
      expect(
        await prepareVerifiedHistoricalUserMetadataOnlyArchive({
          db: executor(),
          authority,
        }),
      ).toBeNull();
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);

      // Core descriptor can still have retentionExpired=false; the final
      // DB gate must independently deny an object expiring too soon.
      await executor().query("UPDATE artifacts SET retention_until=NOW()+INTERVAL '20 seconds' WHERE id=$1", [
        artifactId,
      ]);
      expect(
        await prepareVerifiedHistoricalUserMetadataOnlyArchive({
          db: executor(),
          authority,
        }),
      ).toBeNull();
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
      await executor().query("UPDATE artifacts SET retention_until=NOW()+INTERVAL '1 day' WHERE id=$1", [artifactId]);
    }
    // Both the private format and the original user are still usable when
    // all four independent source-side blockers are removed.
    const recovered = await prepareVerifiedHistoricalUserMetadataOnlyArchive({
      db: executor(),
      authority,
    });
    expect(recovered).not.toBeNull();
    if (!recovered) throw new Error("Fixture unexpectedly denied after unblock");
    expect(verifyHistoricalUserMetadataOnlyArchive(recovered.bytes, recovered.sha256, exportId)).toBe(true);
  });

  it("prepares only an internal ZIP from the original user's consistent snapshot and verified physical bytes", async () => {
    const archive = await prepareVerifiedHistoricalUserPartialArchive({
      db: executor(),
      authority,
      storageRoot,
      storageDriver: "local",
    });
    expect(archive).not.toBeNull();
    if (!archive) return;
    expect(archive.files).toBe(4);
    expect(verifyHistoricalUserPartialArchive(archive.bytes, archive.sha256, exportId)).toBe(true);
    expect(verifyHistoricalUserPartialArchive(archive.bytes, archive.sha256, randomUUID())).toBe(false);
    expect(
      await prepareVerifiedHistoricalUserPartialArchive({
        db: executor(),
        authority: { ...authority, verifiedGitHubUserId: githubUserId + 100 },
        storageRoot,
        storageDriver: "local",
      }),
    ).toBeNull();
    expect(
      await prepareVerifiedHistoricalUserPartialArchive({
        db: executor(),
        authority,
        storageRoot,
        storageDriver: "r2",
      }),
    ).toBeNull();
  });

  it("fsync-seals exact original USER physical ZIP privately, survives reopen and NEVER grants customer delivery", async () => {
    const privateRoot = join(storageRoot, ".private-export-archives");
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        storageRoot,
        privateArchiveRoot: privateRoot,
      }),
    ).toBe(true);
    const archive = await prepareVerifiedHistoricalUserPartialArchive({
      db: executor(),
      authority,
      storageRoot,
      storageDriver: "local",
    });
    if (!archive) throw new Error("Missing verified historical USER archive");

    const input = { archiveRoot: privateRoot, exportId, archive };
    const sealed = await sealHistoricalUserPrivatePartial(input);
    expect(sealed).toEqual({
      exportId,
      sha256: archive.sha256,
      byteLength: archive.byteLength,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
    const location = join(privateRoot, `${exportId}.historical-private-partial-v3.zip`);
    try {
      expect((await lstat(location)).mode & 0o777).toBe(0o600);
      expect((await lstat(location)).nlink).toBe(1);
      expect(
        (
          await readSealedHistoricalUserPartial({
            archiveRoot: privateRoot,
            exportId,
            sha256: archive.sha256,
            byteLength: archive.byteLength,
          })
        )?.equals(archive.bytes),
      ).toBe(true);
      // No-clobber idempotent retry when bytes match.
      expect(await sealHistoricalUserPrivatePartial(input)).toEqual(sealed);
      // Wrong original export identity or forged archive digest cannot open.
      expect(
        await readSealedHistoricalUserPartial({
          archiveRoot: privateRoot,
          exportId: randomUUID(),
          sha256: archive.sha256,
          byteLength: archive.byteLength,
        }),
      ).toBeNull();
      expect(
        await sealHistoricalUserPrivatePartial({
          ...input,
          archive: { ...archive, sha256: "0".repeat(64) },
        }),
      ).toBeNull();
      await writeFile(location, Buffer.from("tampered but still private"));
      expect(
        await readSealedHistoricalUserPartial({
          archiveRoot: privateRoot,
          exportId,
          sha256: archive.sha256,
          byteLength: archive.byteLength,
        }),
      ).toBeNull();
      // Never overwrite an existing corrupt/different destination to
      // manufacture evidence for a historical user after source mutation.
      expect(await sealHistoricalUserPrivatePartial(input)).toBeNull();
      expect((await lstat(location)).size).toBe(Buffer.byteLength("tampered but still private"));
      expect(await executor().query("SELECT status FROM data_exports WHERE id=$1", [exportId])).toMatchObject({
        rows: [expect.objectContaining({ status: "pending" })],
      });
    } finally {
      await unlink(location).catch(() => undefined);
    }
  });

  it("denies world-readable and symlinked private roots before any historical ZIP write", async () => {
    const privateRoot = join(storageRoot, ".private-export-archives");
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        storageRoot,
        privateArchiveRoot: privateRoot,
      }),
    ).toBe(true);
    const archive = await prepareVerifiedHistoricalUserPartialArchive({
      db: executor(),
      authority,
      storageRoot,
      storageDriver: "local",
    });
    if (!archive) throw new Error("Missing private archive fixture");
    const input = { archiveRoot: privateRoot, exportId, archive };
    await chmod(privateRoot, 0o755);
    try {
      expect(await sealHistoricalUserPrivatePartial(input)).toBeNull();
      expect(
        await readSealedHistoricalUserPartial({
          archiveRoot: privateRoot,
          exportId,
          sha256: archive.sha256,
          byteLength: archive.byteLength,
        }),
      ).toBeNull();
    } finally {
      await chmod(privateRoot, 0o700);
    }
    const rogue = await mkdtemp(join(storageRoot, "rogue-"));
    const pathToLink = join(storageRoot, "rogue-link");
    await symlink(privateRoot, pathToLink);
    try {
      expect(
        await sealHistoricalUserPrivatePartial({
          ...input,
          archiveRoot: pathToLink,
        }),
      ).toBeNull();
      expect(
        await sealHistoricalUserPrivatePartial({
          ...input,
          archiveRoot: rogue,
        }),
      ).toBeNull();
    } finally {
      await unlink(pathToLink);
      await rm(rogue, { recursive: true, force: true });
    }
  });

  it("rechecks original USER physical-source and legal policy AFTER private fsync, without creating any delivery right", async () => {
    const privateRoot = join(storageRoot, ".private-export-archives");
    const sealed = await prepareSealedHistoricalUserPrivatePartial({
      db: executor(),
      authority,
      storageRoot,
      storageDriver: "local",
    });
    expect(sealed).toMatchObject({
      exportId,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
    if (!sealed) throw new Error("Expected private original USER stage after post-write DB checks");
    const file = join(privateRoot, `${exportId}.historical-private-partial-v3.zip`);
    try {
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect(
        (
          await readSealedHistoricalUserPartial({
            archiveRoot: privateRoot,
            exportId,
            sha256: sealed.sha256,
            byteLength: sealed.byteLength,
          })
        )?.length,
      ).toBe(sealed.byteLength);
      expect(
        await prepareSealedHistoricalUserPrivatePartial({
          db: executor(),
          authority: { ...authority, verifiedGitHubUserId: githubUserId + 1 },
          storageRoot,
          storageDriver: "local",
        }),
      ).toBeNull();
      expect(
        await prepareSealedHistoricalUserPrivatePartial({
          db: executor(),
          authority,
          storageRoot,
          storageDriver: "r2",
        }),
      ).toBeNull();

      // Even a previously valid, securely persisted ZIP cannot make
      // a later changed physical original-user source eligible.
      await writeFile(join(storageRoot, objectPath), Buffer.from("stale-physical-object"));
      expect(
        await prepareSealedHistoricalUserPrivatePartial({
          db: executor(),
          authority,
          storageRoot,
          storageDriver: "local",
        }),
      ).toBeNull();
      const persisted = await readSealedHistoricalUserPartial({
        archiveRoot: privateRoot,
        exportId,
        sha256: sealed.sha256,
        byteLength: sealed.byteLength,
      });
      expect(persisted).not.toBeNull(); // quarantined bytes, NOT published
      expect((await rows("SELECT status FROM data_exports WHERE id=$1", [exportId]))[0]?.status).toBe("pending");
    } finally {
      await writeFile(join(storageRoot, objectPath), contents);
      await unlink(file).catch(() => undefined);
    }
  });

  it("rejects queued-deletion physical manifest drift during private ZIP stage/inspect even with unchanged core SHA", async () => {
    const archive = await prepareVerifiedHistoricalUserPartialArchive({
      db: executor(),
      authority,
      storageRoot,
      storageDriver: "local",
    });
    if (!archive) throw new Error("Missing physical original USER fixture");
    const jobId = randomUUID();
    const stage = () =>
      stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        archiveBytes: archive.bytes,
        ttlSeconds: 120,
      });
    const insertDeletion = () =>
      executor().query(
        "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes,available_at,created_at) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8,NOW(),NOW())",
        [jobId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
      );
    try {
      await insertDeletion();
      expect(await stage()).toBeNull();
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [jobId]);
      const staged = await stage();
      expect(staged?.id).toMatch(/^[0-9a-f-]{36}$/u);
      if (!staged) throw new Error("Missing private staged original USER ZIP");
      const inspect = () =>
        inspectVerifiedHistoricalUserPrivateArchivePreflight({
          db: executor(),
          authority,
          id: staged.id,
          archiveBytes: archive.bytes,
        });
      expect(await inspect()).toBe("current");
      await insertDeletion();
      expect(await inspect()).toBe("stale");
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [jobId]);
      expect(await inspect()).toBe("current");
      await executor().query("UPDATE artifacts SET retention_until=NOW()+INTERVAL '20 seconds' WHERE id=$1", [
        artifactId,
      ]);
      expect(await inspect()).toBe("stale");
    } finally {
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [jobId]);
      await executor().query("UPDATE artifacts SET retention_until=NOW()+INTERVAL '1 day' WHERE id=$1", [artifactId]);
    }
  });

  it("updates old and new immutable USER epoch scopes when a finding moves across recycled-login repositories", async () => {
    const actual = executor();
    const otherInstallation = randomUUID();
    const otherRepository = randomUUID();
    const otherRun = randomUUID();
    const findingId = randomUUID();
    const foreignGithubUser = githubUserId + 481;
    const before = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
    if (!before) throw new Error("Missing original USER snapshot");
    await actual.query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
      [
        otherInstallation,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        tenant,
        foreignGithubUser,
      ],
    );
    try {
      await actual.query(
        "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at) VALUES($1,$2,$3,$4,'foreign-core-source','main',NOW())",
        [
          otherRepository,
          otherInstallation,
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
          tenant,
        ],
      );
      await actual.query(
        "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
        [otherRun, otherRepository, "c".repeat(40)],
      );
      await actual.query("UPDATE release_runs SET ref='refs/heads/foreign-update' WHERE id=$1", [otherRun]);
      const unchanged = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(unchanged?.mutationEpochSha256).toBe(before.mutationEpochSha256);
      expect(unchanged?.core.sha256).toBe(before.core.sha256);

      await actual.query(
        "INSERT INTO findings(id,run_id,rule_id,severity,message) VALUES($1,$2,'original-owner-moving','warning','unmoved-original')",
        [findingId, runId],
      );
      const original = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      if (!original) throw new Error("Missing owner finding snapshot");

      await actual.query("UPDATE findings SET run_id=$1 WHERE id=$2", [otherRun, findingId]);
      await actual.query("UPDATE findings SET run_id=$1 WHERE id=$2", [runId, findingId]);
      const restored = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(restored?.core.sha256).toBe(original.core.sha256);
      expect(restored?.mutationEpochSha256).not.toBe(original.mutationEpochSha256);

      const foreignEpoch = await rows(
        "SELECT revision FROM historical_user_snapshot_mutation_epochs WHERE installation_id=$1",
        [otherInstallation],
      );
      expect(foreignEpoch).toHaveLength(1);
      expect(Number(foreignEpoch[0]?.revision)).toBeGreaterThanOrEqual(4);
    } finally {
      await actual.query("DELETE FROM findings WHERE id=$1", [findingId]);
      await actual.query("DELETE FROM installations WHERE id=$1", [otherInstallation]);
    }
  });

  it("rejects repo/run/source-finding/artifact edit-restore ABA after content digest returns to baseline", async () => {
    const actual = executor();
    const findingId = randomUUID();
    await actual.query(
      "INSERT INTO findings(id,run_id,rule_id,severity,message) VALUES($1,$2,'fixture-aba-rule','warning','original-finding-message')",
      [findingId, runId],
    );
    try {
      const initial = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      if (!initial) throw new Error("Missing original user baseline");
      let epoch = initial.mutationEpochSha256;
      for (const edit of [
        {
          sql: "UPDATE repositories SET name=$1 WHERE id=$2",
          id: repositoryId,
          changed: "renamed-for-aba",
          restored: "retained-private",
        },
        {
          sql: "UPDATE release_runs SET ref=$1 WHERE id=$2",
          id: runId,
          changed: "refs/heads/changed-for-aba",
          restored: "refs/heads/main",
        },
        {
          sql: "UPDATE findings SET message=$1 WHERE id=$2",
          id: findingId,
          changed: "changed-finding-message",
          restored: "original-finding-message",
        },
        {
          sql: "UPDATE artifacts SET name=$1 WHERE id=$2",
          id: artifactId,
          changed: "changed-private-artifact.bin",
          restored: "private.bin",
        },
      ]) {
        await actual.query(edit.sql, [edit.changed, edit.id]);
        await actual.query(edit.sql, [edit.restored, edit.id]);
        const restored = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
        if (!restored) throw new Error("Missing restored original owner snapshot");
        expect(restored.core.sha256).toBe(initial.core.sha256);
        expect(restored.visual.sha256).toBe(initial.visual.sha256);
        expect(restored.mutationEpochSha256).not.toBe(epoch);
        epoch = restored.mutationEpochSha256;
      }

      const artifact = await lookupHistoricalUserExportObject(actual, authority, artifactId);
      if (!artifact) throw new Error("Missing original owner artifact");
      let wrote = false;
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: actual,
          authority,
          objects: [artifact],
          expectedCore: { sha256: initial.core.sha256, byteLength: initial.core.byteLength },
          expectedVisual: {
            sha256: initial.visual.sha256,
            byteLength: initial.visual.byteLength,
            visualCount: initial.visual.visualCount,
          },
          expectedMutationEpochSha256: initial.mutationEpochSha256,
          underLock: async () => {
            wrote = true;
          },
        }),
      ).toBe("stale");
      expect(wrote).toBe(false);

      await expect(
        actual.withTransaction(async (tx) => {
          await tx.query("UPDATE artifacts SET name='rolled-back-artifact' WHERE id=$1", [artifactId]);
          throw new Error("rollback-core-source-epoch");
        }),
      ).rejects.toThrow("rollback-core-source-epoch");
      const afterRollback = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(afterRollback?.mutationEpochSha256).toBe(epoch);
    } finally {
      await actual.query("DELETE FROM findings WHERE id=$1", [findingId]);
    }
  });

  it("isolates collaboration revision from a recycled-login different numeric GitHub USER", async () => {
    const actual = executor();
    const otherInstallation = randomUUID();
    const otherRepository = randomUUID();
    const otherRun = randomUUID();
    const otherReview = randomUUID();
    const otherComment = randomUUID();
    const baseline = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
    if (!baseline) throw new Error("Missing original owner baseline");
    await actual.query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
      [otherInstallation, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant, githubUserId + 9],
    );
    try {
      await actual.query(
        "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at) VALUES($1,$2,$3,$4,'foreign-recycled-account','main',NOW())",
        [
          otherRepository,
          otherInstallation,
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
          tenant,
        ],
      );
      await actual.query(
        "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
        [otherRun, otherRepository, "e".repeat(40)],
      );
      await actual.query(
        "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'foreign-original-recycled-login')",
        [otherReview, otherRepository, otherRun],
      );
      await actual.query(
        "INSERT INTO review_comments(id,repository_id,review_id,author_id,content) VALUES($1,$2,$3,'foreign-actor','foreign-original-comment')",
        [otherComment, otherRepository, otherReview],
      );
      await actual.query("UPDATE review_comments SET content='foreign-edited-comment' WHERE id=$1", [otherComment]);
      const unchanged = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(unchanged?.mutationEpochSha256).toBe(baseline.mutationEpochSha256);
      expect(unchanged?.core.sha256).toBe(baseline.core.sha256);
      expect(unchanged?.visual.sha256).toBe(baseline.visual.sha256);
      const otherEpochRows = await rows(
        "SELECT revision FROM historical_user_snapshot_mutation_epochs WHERE installation_id=$1",
        [otherInstallation],
      );
      expect(otherEpochRows).toHaveLength(1);
      expect(Number(otherEpochRows[0]?.revision)).toBeGreaterThan(1);
    } finally {
      await actual.query("DELETE FROM installations WHERE id=$1", [otherInstallation]);
    }
  });

  it("tracks committed edit-restore ABA across all six original USER review collaboration classes", async () => {
    const actual = executor();
    const reviewId = randomUUID();
    const revisionId = randomUUID();
    const fingerprint = ["fixture-collaboration", randomUUID()].join("-");
    const approvalId = randomUUID();
    const commentId = randomUUID();
    const checklistId = randomUUID();
    const decisionId = randomUUID();
    const assignmentId = randomUUID();
    await actual.query(
      "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'collaboration-epoch-baseline')",
      [reviewId, repositoryId, runId],
    );
    try {
      await actual.query(
        "INSERT INTO review_revisions(id,review_id,sequence,head_run_id,head_commit_sha,evidence_digest) VALUES($1,$2,1,$3,$4,$5)",
        [revisionId, reviewId, runId, "a".repeat(40), "b".repeat(64)],
      );
      await actual.query(
        "INSERT INTO review_comments(id,repository_id,review_id,author_id,content) VALUES($1,$2,$3,'private-author','initial-comment')",
        [commentId, repositoryId, reviewId],
      );
      await actual.query(
        "INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,approver_id,status,reason) VALUES($1,$2,$3,$4,$5,'private-approver','approved','initial-reason')",
        [approvalId, repositoryId, reviewId, revisionId, "b".repeat(64)],
      );
      await actual.query(
        "INSERT INTO review_checklist_items(id,repository_id,review_id,title) VALUES($1,$2,$3,'initial-checklist')",
        [checklistId, repositoryId, reviewId],
      );
      await actual.query(
        "INSERT INTO finding_decisions(id,repository_id,review_id,finding_fingerprint,disposition,reason,owner,evidence_digest,actor_id) VALUES($1,$2,$3,$4,'false_positive','initial-finding-reason','private-owner',$5,'private-actor')",
        [decisionId, repositoryId, reviewId, fingerprint, "b".repeat(64)],
      );
      await actual.query(
        "INSERT INTO finding_assignments(id,repository_id,review_id,finding_fingerprint,assignee,assigned_by) VALUES($1,$2,$3,$4,'private-assignee','private-assigner')",
        [assignmentId, repositoryId, reviewId, fingerprint],
      );
      const initial = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      if (!initial) throw new Error("Missing original USER snapshot");
      let epoch = initial.mutationEpochSha256;
      const reversals: Array<{ sql: string; mutated: unknown; original: unknown; id: string }> = [
        {
          sql: "UPDATE review_revisions SET head_commit_sha=$1 WHERE id=$2",
          mutated: "c".repeat(40),
          original: "a".repeat(40),
          id: revisionId,
        },
        {
          sql: "UPDATE review_comments SET content=$1 WHERE id=$2",
          mutated: "edited-comment",
          original: "initial-comment",
          id: commentId,
        },
        {
          sql: "UPDATE review_approvals SET reason=$1 WHERE id=$2",
          mutated: "edited-reason",
          original: "initial-reason",
          id: approvalId,
        },
        {
          sql: "UPDATE review_checklist_items SET title=$1 WHERE id=$2",
          mutated: "edited-checklist",
          original: "initial-checklist",
          id: checklistId,
        },
        {
          sql: "UPDATE finding_decisions SET reason=$1 WHERE id=$2",
          mutated: "edited-finding-reason",
          original: "initial-finding-reason",
          id: decisionId,
        },
        {
          sql: "UPDATE finding_assignments SET assignee=$1 WHERE id=$2",
          mutated: "edited-assignee",
          original: "private-assignee",
          id: assignmentId,
        },
      ];
      for (const test of reversals) {
        await actual.query(test.sql, [test.mutated, test.id]);
        await actual.query(test.sql, [test.original, test.id]);
        const restored = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
        if (!restored) throw new Error("Missing restored original USER snapshot");
        expect(restored.core.sha256).toBe(initial.core.sha256);
        expect(restored.visual.sha256).toBe(initial.visual.sha256);
        expect(restored.mutationEpochSha256).not.toBe(epoch);
        epoch = restored.mutationEpochSha256;
      }
      const object = await lookupHistoricalUserExportObject(actual, authority, artifactId);
      if (!object) throw new Error("Missing original USER artifact");
      let attempted = false;
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: actual,
          authority,
          objects: [object],
          expectedCore: { sha256: initial.core.sha256, byteLength: initial.core.byteLength },
          expectedVisual: {
            sha256: initial.visual.sha256,
            byteLength: initial.visual.byteLength,
            visualCount: initial.visual.visualCount,
          },
          expectedMutationEpochSha256: initial.mutationEpochSha256,
          underLock: async () => {
            attempted = true;
          },
        }),
      ).toBe("stale");
      expect(attempted).toBe(false);
      await expect(
        actual.withTransaction(async (tx) => {
          await tx.query("UPDATE review_comments SET content='rolled-back-review-comment' WHERE id=$1", [commentId]);
          throw new Error("rollback-collaboration-revision");
        }),
      ).rejects.toThrow("rollback-collaboration-revision");
      const afterRollback = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(afterRollback?.mutationEpochSha256).toBe(epoch);
    } finally {
      await actual.query("DELETE FROM reviews WHERE id=$1", [reviewId]);
    }
  });

  it("detects committed original-user review and private SVG edit-restore ABA despite identical SHA content", async () => {
    const actual = executor();
    const visualId = randomUUID();
    const reviewId = randomUUID();
    const originalSvg = "<svg>original-private-visual</svg>";
    const otherSvg = "<svg>modified-private-visual</svg>";
    const sourceSha = createHash("sha256").update(originalSvg).digest("hex");
    const editedSha = createHash("sha256").update(otherSvg).digest("hex");
    await actual.query(
      "INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256) VALUES($1,$2,'stable-original-design','original.svg','pcb_layer','svg','F.Cu',50,50,$3,$4)",
      [visualId, runId, originalSvg, sourceSha],
    );
    await actual.query(
      "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'original-review-title')",
      [reviewId, repositoryId, runId],
    );
    try {
      const initial = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      if (!initial) throw new Error("Missing original user core");
      await actual.query("UPDATE run_snapshots SET content=$1,sha256=$2 WHERE id=$3", [otherSvg, editedSha, visualId]);
      await actual.query("UPDATE run_snapshots SET content=$1,sha256=$2 WHERE id=$3", [
        originalSvg,
        sourceSha,
        visualId,
      ]);
      await actual.query("UPDATE reviews SET title='revised-review-title' WHERE id=$1", [reviewId]);
      await actual.query("UPDATE reviews SET title='original-review-title' WHERE id=$1", [reviewId]);
      const restored = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      if (!restored) throw new Error("Missing restored original core");
      expect(restored.core.sha256).toBe(initial.core.sha256);
      expect(restored.visual.sha256).toBe(initial.visual.sha256);
      expect(restored.mutationEpochSha256).not.toBe(initial.mutationEpochSha256);

      const originalObject = await lookupHistoricalUserExportObject(actual, authority, artifactId);
      if (!originalObject) throw new Error("Missing original user artifact");
      let attempted = false;
      const status = await checkHistoricalUserArchivePrepublication({
        db: actual,
        authority,
        objects: [originalObject],
        expectedCore: { sha256: initial.core.sha256, byteLength: initial.core.byteLength },
        expectedVisual: {
          sha256: initial.visual.sha256,
          byteLength: initial.visual.byteLength,
          visualCount: initial.visual.visualCount,
        },
        expectedMutationEpochSha256: initial.mutationEpochSha256,
        underLock: async () => {
          attempted = true;
        },
      });
      expect(status).toBe("stale");
      expect(attempted).toBe(false);

      const nextStamp = restored.mutationEpochSha256;
      await expect(
        actual.withTransaction(async (tx) => {
          await tx.query("UPDATE reviews SET title='rolled-back-test-edit' WHERE id=$1", [reviewId]);
          throw new Error("rollback-epoch-update");
        }),
      ).rejects.toThrow("rollback-epoch-update");
      const afterRollback = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(afterRollback?.mutationEpochSha256).toBe(nextStamp);
      expect(afterRollback?.core.sha256).toBe(initial.core.sha256);
    } finally {
      await actual.query("DELETE FROM reviews WHERE id=$1", [reviewId]);
      await actual.query("DELETE FROM run_snapshots WHERE id=$1", [visualId]);
    }
  });

  it("reads original USER core and private visual evidence in ONE repeatable-read PG snapshot", async () => {
    const actual = executor();
    const visualId = randomUUID();
    const content = "<svg>private-after-core-select</svg>";
    const hash = createHash("sha256").update(content).digest("hex");
    let visualQueries = 0;
    let consistentTransactions = 0;
    const observed = {
      ...actual,
      async withTransaction<T>(
        work: Parameters<typeof actual.withTransaction<T>>[0],
        options?: Parameters<typeof actual.withTransaction<T>>[1],
      ): Promise<T> {
        if (options?.consistentRead !== true) return actual.withTransaction(work, options);
        consistentTransactions++;
        return actual.withTransaction(
          async (tx) =>
            work({
              query: async (sql, params) => {
                if (sql.includes("scoped_visual_rows")) {
                  visualQueries++;
                  if (visualQueries === 1) {
                    // Committed by a different PG client *between* the core and
                    // visual queries. The old implementation read two snapshots
                    // and could see core visual count=0 but visual count=1.
                    await actual.query(
                      "INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256) VALUES($1,$2,'private-phantom','secret.svg','pcb_layer','svg','F.Cu',100,80,$3,$4)",
                      [visualId, runId, content, hash],
                    );
                  }
                }
                return tx.query(sql, params);
              },
            }),
          options,
        );
      },
    };
    try {
      const sealed = await prepareVerifiedHistoricalUserCompositePreflight(observed, authority);
      expect(consistentTransactions).toBe(1);
      expect(visualQueries).toBe(1);
      expect(sealed?.visual.visualCount).toBe(0);
      const oldCore = JSON.parse(sealed?.core.bytes.toString("utf8") ?? "{}");
      expect(oldCore.excludedSourceClassCounts?.runSnapshots).toBe(0);
      const newState = await prepareVerifiedHistoricalUserCompositePreflight(actual, authority);
      expect(newState?.visual.visualCount).toBe(1);
      const newCore = JSON.parse(newState?.core.bytes.toString("utf8") ?? "{}");
      expect(newCore.excludedSourceClassCounts?.runSnapshots).toBe(1);
    } finally {
      await actual.query("DELETE FROM run_snapshots WHERE id=$1", [visualId]);
    }
  });

  it("seals SHA-verified original USER visual descriptors into the private ZIP and rejects intervening edits", async () => {
    const visualId = randomUUID();
    const source = "<svg xmlns='http://www.w3.org/2000/svg'><text>private-render-not-for-zip</text></svg>";
    const modified = "<svg xmlns='http://www.w3.org/2000/svg'><text>changed-after-read</text></svg>";
    const sourceSha = createHash("sha256").update(source).digest("hex");
    const changedSha = createHash("sha256").update(modified).digest("hex");
    await executor().query(
      "INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256) VALUES($1,$2,'private-sheet-label','private-board.svg','pcb_layer','svg','F.Cu',100,80,$3,$4)",
      [visualId, runId, source, sourceSha],
    );
    const actual = executor();
    try {
      const archive = await prepareVerifiedHistoricalUserPartialArchive({
        db: actual,
        authority,
        storageRoot,
        storageDriver: "local",
      });
      expect(archive?.files).toBe(4);
      if (!archive) throw new Error("Missing private composite archive");
      expect(verifyHistoricalUserPartialArchive(archive.bytes, archive.sha256, exportId)).toBe(true);
      const extracted = sanitizeAndExtractArchive(archive.bytes).files;
      const byName = new Map(extracted.map((file) => [file.path, file.data]));
      const visualEvidence = JSON.parse(
        byName.get("metadata/historical-private-visual-evidence.json")?.toString("utf8") ?? "{}",
      );
      expect(visualEvidence.visuals).toEqual([
        expect.objectContaining({
          id: visualId,
          runId,
          repositoryId,
          sha256: sourceSha,
          byteLength: Buffer.byteLength(source),
        }),
      ]);
      expect(visualEvidence.contentIncluded).toBe(false);
      const receipt = JSON.parse(byName.get("metadata/historical-integrity.json")?.toString("utf8") ?? "{}");
      expect(receipt).toMatchObject({
        formatVersion: 3,
        originalUserMutationEpochSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        verifiedPrivateVisualDigestCount: 1,
        privateVisualContentsIncluded: false,
      });
      expect(JSON.stringify(visualEvidence)).not.toContain("private-render-not-for-zip");
      expect(JSON.stringify(visualEvidence)).not.toContain("private-sheet-label");
      expect(archive.bytes.includes(Buffer.from("private-render-not-for-zip"))).toBe(false);

      const object = await lookupHistoricalUserExportObject(actual, authority, artifactId);
      if (!object) throw new Error("Missing historical artifact for visual gate");
      const visualBytes = byName.get("metadata/historical-private-visual-evidence.json");
      if (!visualBytes) throw new Error("Missing checked visual evidence");
      const expectedVisual = {
        sha256: createHash("sha256").update(visualBytes).digest("hex"),
        byteLength: visualBytes.length,
        visualCount: 1,
      };
      let wrote = false;
      const gate = () =>
        checkHistoricalUserArchivePrepublication({
          db: actual,
          authority,
          objects: [object],
          expectedVisual,
          underLock: async () => {
            wrote = true;
          },
        });
      expect(await gate()).toBe("eligible");
      expect(wrote).toBe(true);
      wrote = false;
      await actual.query("UPDATE run_snapshots SET content=$1,sha256=$2 WHERE id=$3", [modified, changedSha, visualId]);
      expect(await gate()).toBe("stale");
      expect(wrote).toBe(false);
      await actual.query("UPDATE run_snapshots SET content=$1,sha256=$2 WHERE id=$3", [source, sourceSha, visualId]);
      expect(await gate()).toBe("eligible");

      let snapshots = 0;
      const intercepted = {
        ...actual,
        async withTransaction<T>(
          work: Parameters<typeof actual.withTransaction<T>>[0],
          options?: Parameters<typeof actual.withTransaction<T>>[1],
        ): Promise<T> {
          if (options?.consistentRead === true) snapshots++;
          if (options?.consistentRead === true && snapshots === 2) {
            await actual.query("UPDATE run_snapshots SET content=$1,sha256=$2 WHERE id=$3", [
              modified,
              changedSha,
              visualId,
            ]);
          }
          return actual.withTransaction(work, options);
        },
      };
      await expect(
        prepareVerifiedHistoricalUserPartialArchive({
          db: intercepted,
          authority,
          storageRoot,
          storageDriver: "local",
        }),
      ).rejects.toBeInstanceOf(HistoricalUserArchivePreflightError);
      expect(snapshots).toBe(2);
      const reservations = await rows(
        "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
        [exportId],
      );
      expect(reservations[0]?.total).toBe(0);
    } finally {
      await actual.query("DELETE FROM run_snapshots WHERE id=$1", [visualId]);
    }
  });

  it("holds every original USER path until the entire two-object ZIP is assembled", async () => {
    const secondId = randomUUID();
    const secondPath = ["artifacts", `${randomUUID()}.bin`].join("/");
    const secondBytes = Buffer.from("second-original-user-private-archive-evidence", "utf8");
    const secondHash = createHash("sha256").update(secondBytes).digest("hex");
    await writeFile(join(storageRoot, secondPath), secondBytes);
    await executor().query(
      `INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until)
         VALUES($1,$2,'manufacturing','private-second.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')`,
      [secondId, runId, secondPath, secondHash, secondBytes.length],
    );
    const actual = executor();
    let objectLookups = 0;
    const activeAtReadAdmission: number[] = [];
    const intercepted = {
      ...actual,
      async query(sql: string, args?: readonly unknown[]) {
        if (sql.includes("SELECT a.id, a.run_id")) {
          objectLookups++;
          if (objectLookups === 3 || objectLookups === 5) {
            const active = await rows(
              "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
              [exportId],
            );
            activeAtReadAdmission.push(Number(active[0]?.total));
          }
        }
        return actual.query(sql, args);
      },
    };
    try {
      const archive = await prepareVerifiedHistoricalUserPartialArchive({
        db: intercepted,
        authority,
        storageRoot,
        storageDriver: "local",
      });
      expect(archive?.files).toBe(5);
      expect(archive && verifyHistoricalUserPartialArchive(archive.bytes, archive.sha256, exportId)).toBe(true);
      expect(activeAtReadAdmission).toEqual([2, 2]);
      const after = await rows(
        "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
        [exportId],
      );
      expect(after[0]?.total).toBe(0);
    } finally {
      await actual.query("DELETE FROM artifacts WHERE id=$1", [secondId]);
      await rm(join(storageRoot, secondPath), { force: true });
    }
  });

  it("atomically rolls back a multi-object fence if the second admission is not authorized", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    const fake = {
      ...object,
      artifactId: randomUUID(),
      storagePath: "artifacts/fake-rollback-only.bin",
    };
    const rejected = await reserveHistoricalUserObjectBatch(executor(), authority, [object, fake]);
    expect(rejected).toBeNull();
    const active = await rows(
      "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
      [exportId],
    );
    expect(active[0]?.total).toBe(0);
    const admitted = await reserveHistoricalUserObjectBatch(executor(), authority, [object]);
    expect(admitted).not.toBeNull();
    if (!admitted) throw new Error("Original USER copy should admit");
    try {
      const reserved = await rows(
        "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
        [exportId],
      );
      expect(reserved[0]?.total).toBe(1);
    } finally {
      await releaseHistoricalUserObjectBatch(executor(), authority, admitted);
    }
  });

  it("rejects whole archive when core metadata changes between verified IO and final snapshot", async () => {
    let snapshots = 0;
    const actual = executor();
    const intercepted = {
      ...actual,
      async withTransaction<T>(
        work: Parameters<typeof actual.withTransaction<T>>[0],
        options?: Parameters<typeof actual.withTransaction<T>>[1],
      ): Promise<T> {
        if (options?.consistentRead === true) snapshots++;
        if (options?.consistentRead === true && snapshots === 2) {
          await actual.query("UPDATE artifacts SET sha256=$1 WHERE id=$2", ["e".repeat(64), artifactId]);
        }
        return actual.withTransaction(work, options);
      },
    };
    try {
      await expect(
        prepareVerifiedHistoricalUserPartialArchive({
          db: intercepted,
          authority,
          storageRoot,
          storageDriver: "local",
        }),
      ).rejects.toBeInstanceOf(HistoricalUserArchivePreflightError);
      expect(snapshots).toBe(2);
    } finally {
      await actual.query("UPDATE artifacts SET sha256=$1 WHERE id=$2", [digest, artifactId]);
    }
  });

  it("requires current original USER, exact artifact manifest and conservatively reviews legal holds", async () => {
    const original = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!original) throw new Error("Missing original USER object");
    const check = (objects = [original], verifiedGitHubUserId = githubUserId) =>
      checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority: { exportId, verifiedGitHubUserId },
        objects,
      });
    expect(await check()).toBe("eligible");
    expect(await check([original], githubUserId + 1)).toBe("stale");
    expect(await check([])).toBe("stale");
    expect(await check([{ ...original, sha256: "0".repeat(64) }])).toBe("stale");

    const holdId = randomUUID();
    await executor().query(
      "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'system','Litigation preservation','user',$2)",
      [holdId, tenant.toUpperCase()],
    );
    try {
      expect(await check()).toBe("held");
      // The shared source-authorization CTE now denies this BEFORE object
      // preparation begins. Both null and the former typed error deny ZIP
      // bytes; assert the stronger early no-archive result explicitly.
      expect(
        await prepareVerifiedHistoricalUserPartialArchive({
          db: executor(),
          authority,
          storageRoot,
          storageDriver: "local",
        }),
      ).toBeNull();
      const active = await rows(
        "SELECT count(*)::integer AS total FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
        [exportId],
      );
      expect(active[0]?.total).toBe(0);
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
    expect(await check()).toBe("eligible");
  });

  it("blocks stale export, erasure running, imminent retention and newly omitted artifact", async () => {
    const obj = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!obj) throw new Error("Missing original USER object");
    const check = () =>
      checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [obj],
      });
    expect(await check()).toBe("eligible");
    await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
    try {
      expect(await check()).toBe("stale");
    } finally {
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    }
    const erasureId = randomUUID();
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,status,dry_run) VALUES($1,$2,'system','organization','running',FALSE)",
      [erasureId, tenant],
    );
    try {
      expect(await check()).toBe("stale");
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    }
    const repoErasureId = randomUUID();
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'system','repository',$3,'running',FALSE)",
      [repoErasureId, tenant, repositoryId],
    );
    try {
      expect(await check()).toBe("stale");
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [repoErasureId]);
    }
    await executor().query("UPDATE artifacts SET retention_until=NOW()+INTERVAL '30 seconds' WHERE id=$1", [
      artifactId,
    ]);
    try {
      expect(await check()).toBe("stale");
    } finally {
      await executor().query("UPDATE artifacts SET retention_until=$1::timestamptz WHERE id=$2", [
        obj.retentionUntil,
        artifactId,
      ]);
    }
    const extraId = randomUUID();
    await executor().query(
      "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until) VALUES($1,$2,'manufacturing','extra.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')",
      [extraId, runId, ["artifacts", `${extraId}.bin`].join("/"), digest, contents.length],
    );
    try {
      expect(await check()).toBe("stale");
      await expect(
        prepareVerifiedHistoricalUserPartialArchive({
          db: executor(),
          authority,
          storageRoot,
          storageDriver: "local",
        }),
      ).rejects.toBeInstanceOf(HistoricalUserArchivePreflightError);
    } finally {
      await executor().query("DELETE FROM artifacts WHERE id=$1", [extraId]);
    }
    expect(await check()).toBe("eligible");
    const deletionId = randomUUID();
    await executor().query(
      "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes,available_at,created_at) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8,NOW(),NOW())",
      [deletionId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
    );
    try {
      expect(await check()).toBe("stale");
    } finally {
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [deletionId]);
    }
    expect(await check()).toBe("eligible");
  });

  it("keeps original-user revocation and hold-writer locks through an awaited transport operation", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    let entered: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const enteredTransport = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pendingTransport = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active = checkHistoricalUserArchivePrepublication({
      db: executor(),
      authority,
      objects: [object],
      underLock: async () => {
        entered?.();
        await pendingTransport;
      },
    });
    await enteredTransport;
    try {
      // The export row cannot be revoked behind an in-flight transfer.
      await expect(
        executor().query("SELECT id FROM data_exports WHERE id=$1 FOR UPDATE NOWAIT", [exportId]),
      ).rejects.toMatchObject({ code: "55P03" });
      // A tenant legal-hold writer also cannot race through an accepted
      // transport segment. Its conflicting INSERT must fail a bounded wait.
      await expect(
        executor().withTransaction(async (tx) => {
          await tx.query("SET LOCAL lock_timeout='120ms'");
          await tx.query(
            "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'system','Hold while sending','user',$2)",
            [randomUUID(), tenant],
          );
        }),
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      finish?.();
    }
    expect(await active).toBe("eligible");
    // Only AFTER the bounded transport's acknowledgement may a revoke
    // complete. The next chunk must not invoke its transport callback.
    await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
    let delivered = false;
    try {
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
          underLock: async () => {
            delivered = true;
          },
        }),
      ).toBe("stale");
      expect(delivered).toBe(false);
    } finally {
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    }
  });

  it("blocks same-tenant erasure INSERT and artifact INSERT during bounded transfer without blocking other tenants", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    let admitted: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = checkHistoricalUserArchivePrepublication({
      db: executor(),
      authority,
      objects: [object],
      underLock: async () => {
        admitted?.();
        await pending;
      },
    });
    await started;
    const erasureId = randomUUID();
    const additionalId = randomUUID();
    const queuedId = randomUUID();
    try {
      // Force a short negative test without changing the production writer's
      // bounded trigger lock_timeout. Cancellation rolls back the insert.
      await expect(
        executor().withTransaction(async (tx) => {
          await tx.query("SET LOCAL statement_timeout='250ms'");
          await tx.query(
            "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'synthetic','user',$2,'running',FALSE)",
            [erasureId, tenant.toUpperCase()],
          );
        }),
      ).rejects.toMatchObject({ code: "57014" });
      await expect(
        executor().withTransaction(async (tx) => {
          await tx.query("SET LOCAL statement_timeout='250ms'");
          await tx.query(
            "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until) VALUES($1,$2,'manufacturing','unadmitted.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')",
            [additionalId, runId, ["artifacts", additionalId].join("/"), digest, contents.length],
          );
        }),
      ).rejects.toMatchObject({ code: "57014" });
      // Even a raw SQL job for an existing path cannot race a checked chunk;
      // it need not mutate the original artifact's already locked row.
      await expect(
        executor().withTransaction(async (tx) => {
          await tx.query("SET LOCAL statement_timeout='250ms'");
          await tx.query(
            "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8)",
            [queuedId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
          );
        }),
      ).rejects.toMatchObject({ code: "57014" });
      // A distinct tenant's legal-purpose erasure intake is unaffected.
      const otherId = randomUUID();
      try {
        await executor().query(
          "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,status,dry_run) VALUES($1,$2,'synthetic','organization','running',FALSE)",
          [otherId, `unrelated-${randomUUID()}`],
        );
      } finally {
        await executor().query("DELETE FROM erasure_requests WHERE id=$1", [otherId]);
      }
      expect((await rows("SELECT id FROM erasure_requests WHERE id=$1", [erasureId])).length).toBe(0);
      expect((await rows("SELECT id FROM artifacts WHERE id=$1", [additionalId])).length).toBe(0);
      expect((await rows("SELECT id FROM artifact_deletion_jobs WHERE id=$1", [queuedId])).length).toBe(0);
    } finally {
      release?.();
      await inFlight;
    }
    // A newly queued, direct-SQL physical deletion after this transaction
    // must invalidate the next write even though it did not remove metadata.
    await executor().query(
      "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8)",
      [queuedId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
    );
    try {
      let queueDelivered = false;
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
          underLock: async () => {
            queueDelivered = true;
          },
        }),
      ).toBe("stale");
      expect(queueDelivered).toBe(false);
    } finally {
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [queuedId]);
    }
    // Writes are admitted after the transport settles; the NEXT attempted
    // write sees a running erasure and rejects without invoking its callback.
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'synthetic','user',$2,'running',FALSE)",
      [erasureId, tenant],
    );
    let wroteChunk = false;
    try {
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
          underLock: async () => {
            wroteChunk = true;
          },
        }),
      ).toBe("stale");
      expect(wroteChunk).toBe(false);
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    }
    expect(
      await checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
      }),
    ).toBe("eligible");
  });

  it("fails busy without deadlocking a retention-style artifact writer that already owns its row lock", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER artifact");
    let held: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      held = resolve;
    });
    const continueMaintenance = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const queueId = randomUUID();
    const writer = executor().withTransaction(async (tx) => {
      // Matches retention maintenance, which locks artifacts FOR UPDATE
      // before queuing a physical deletion.
      await tx.query("SELECT id FROM artifacts WHERE id=$1 FOR UPDATE", [artifactId]);
      held?.();
      await continueMaintenance;
      await tx.query(
        "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8)",
        [queueId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
      );
    });
    await locked;
    try {
      // The gate has a NOWAIT on every artifact row. It MUST fail closed and
      // release its advisory key rather than wait while owning the key and
      // forming an artifact-row -> advisory-lock deadlock cycle.
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
        }),
      ).toBe("busy");
    } finally {
      finish?.();
      await writer;
    }
    try {
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
        }),
      ).toBe("stale");
    } finally {
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE id=$1", [queueId]);
    }
    expect(
      await checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
      }),
    ).toBe("eligible");
  });

  it("binds later bounded writes to non-redacted core state and rejects review-status drift", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    const originalCore = await prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), authority);
    if (!object || !originalCore) throw new Error("Missing original USER core");
    const expectedCore = { sha256: originalCore.sha256, byteLength: originalCore.byteLength };
    let writes = 0;
    const check = (expected = expectedCore, underLock?: () => Promise<void>) =>
      checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
        expectedCore: expected,
        underLock: async () => {
          writes++;
          if (underLock) await underLock();
        },
      });
    expect(await check()).toBe("eligible");
    expect(writes).toBe(1);
    expect(await check({ ...expectedCore, sha256: "f".repeat(64) })).toBe("stale");
    expect(await check({ ...expectedCore, byteLength: expectedCore.byteLength + 1 })).toBe("stale");
    expect(writes).toBe(1);

    const reviewId = randomUUID();
    await executor().query(
      "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'baseline-review')",
      [reviewId, repositoryId, runId],
    );
    try {
      // A previously built ZIP cannot be reused after a review INSERT even
      // when every physical artifact remains byte-for-byte unchanged.
      expect(await check()).toBe("stale");
      expect(writes).toBe(1);
      const updatedCore = await prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), authority);
      if (!updatedCore) throw new Error("Missing updated core");
      const fresh = { sha256: updatedCore.sha256, byteLength: updatedCore.byteLength };
      expect(await check(fresh)).toBe("eligible");
      expect(writes).toBe(2);

      // Review title is intentionally REDACTED from this partial core.
      // Exercise a retained review STATUS edit for the core-only gate;
      // separate epoch-bound tests cover committed title edit/restore ABA.
      // Recheck AFTER callback to reject a stale source state.
      expect(
        await check(fresh, async () => {
          await executor().query("UPDATE reviews SET status='awaiting_decision' WHERE id=$1", [reviewId]);
        }),
      ).toBe("stale");
      expect(writes).toBe(3);
      await executor().query("UPDATE reviews SET status='active' WHERE id=$1", [reviewId]);
      expect(await check(fresh)).toBe("eligible");
      expect(writes).toBe(4);
    } finally {
      await executor().query("DELETE FROM reviews WHERE id=$1", [reviewId]);
    }
    expect(await check()).toBe("eligible");
    expect(writes).toBe(5);
  });

  it("fences same-tenant append-only audit and review INSERTs during an original USER chunk, not other accounts", async () => {
    const original = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!original) throw new Error("Missing original USER fixture");
    const auditId = randomUUID();
    const reviewId = randomUUID();
    const unrelatedInstallationId = randomUUID();
    const unrelatedAuditId = randomUUID();
    const unrelatedLogin = `unrelated-audit-${randomUUID()}`;
    await executor().query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
      [
        unrelatedInstallationId,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        unrelatedLogin,
        githubUserId + 444,
      ],
    );
    let begin: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const continued = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const inFlight = checkHistoricalUserArchivePrepublication({
      db: executor(),
      authority,
      objects: [original],
      underLock: async () => {
        begin?.();
        await continued;
      },
    });
    try {
      await entered;
      for (const [sql, params] of [
        [
          "INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type) VALUES($1,$2,'review.created','system','review')",
          [auditId, installationId],
        ],
        [
          "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'new-review-between-chunks')",
          [reviewId, repositoryId, runId],
        ],
      ] as Array<[string, unknown[]]>) {
        await expect(
          executor().withTransaction(async (tx) => {
            await tx.query("SET LOCAL statement_timeout='250ms'");
            await tx.query(sql, params);
          }),
        ).rejects.toMatchObject({ code: "57014" });
      }
      // An unrelated former USER installation is not globally locked.
      await executor().query(
        "INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type) VALUES($1,$2,'installation.suspended','system','installation')",
        [unrelatedAuditId, unrelatedInstallationId],
      );
      expect((await rows("SELECT id FROM audit_events WHERE id=$1", [unrelatedAuditId])).length).toBe(1);
      expect((await rows("SELECT id FROM audit_events WHERE id=$1", [auditId])).length).toBe(0);
      expect((await rows("SELECT id FROM reviews WHERE id=$1", [reviewId])).length).toBe(0);
    } finally {
      finish?.();
      expect(await inFlight).toBe("eligible");
      await executor().query("DELETE FROM installations WHERE id=$1", [unrelatedInstallationId]);
    }
    // On the next transaction, both writers must resume normally. Roll back
    // synthetic test data rather than introducing a new audit event forever.
    await expect(
      executor().withTransaction(async (tx) => {
        await tx.query(
          "INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type) VALUES($1,$2,'review.created','system','review')",
          [auditId, installationId],
        );
        await tx.query(
          "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'new-review-between-chunks')",
          [reviewId, repositoryId, runId],
        );
        const a = (await tx.query("SELECT count(*)::integer AS total FROM audit_events WHERE id=$1", [auditId])) as {
          rows: Array<{ total: number }>;
        };
        const r = (await tx.query("SELECT count(*)::integer AS total FROM reviews WHERE id=$1", [reviewId])) as {
          rows: Array<{ total: number }>;
        };
        expect(a.rows[0]?.total).toBe(1);
        expect(r.rows[0]?.total).toBe(1);
        throw new Error("fixture-only-audit-review-rollback");
      }),
    ).rejects.toThrow("fixture-only-audit-review-rollback");
    expect((await rows("SELECT id FROM audit_events WHERE id=$1", [auditId])).length).toBe(0);
    expect((await rows("SELECT id FROM reviews WHERE id=$1", [reviewId])).length).toBe(0);
  });

  it("blocks review ownership reparenting out of an original USER while its transfer is admitted", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    const otherInstallId = randomUUID();
    const otherRepoId = randomUUID();
    const reviewId = randomUUID();
    const otherTenant = `unrelated-review-${randomUUID()}`;
    await executor().query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
      [
        otherInstallId,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        otherTenant,
        githubUserId + 888,
      ],
    );
    try {
      await executor().query(
        "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'foreign-review-repo','main')",
        [otherRepoId, otherInstallId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), otherTenant],
      );
      await executor().query(
        "INSERT INTO reviews(id,repository_id,head_run_id,title) VALUES($1,$2,$3,'original-owner-review')",
        [reviewId, repositoryId, runId],
      );
      let notify: (() => void) | undefined;
      let resume: (() => void) | undefined;
      const entered = new Promise<void>((resolve) => {
        notify = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const active = checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
        underLock: async () => {
          notify?.();
          await pending;
        },
      });
      await entered;
      try {
        await expect(
          executor().withTransaction(async (tx) => {
            await tx.query("SET LOCAL statement_timeout='250ms'");
            await tx.query("UPDATE reviews SET repository_id=$1 WHERE id=$2", [otherRepoId, reviewId]);
          }),
        ).rejects.toMatchObject({ code: "57014" });
        const current = await rows("SELECT repository_id FROM reviews WHERE id=$1", [reviewId]);
        expect(current[0]?.repository_id).toBe(repositoryId);
      } finally {
        resume?.();
        expect(await active).toBe("eligible");
      }
      // The OLD tenant lock is released after the bounded operation; the
      // reparent can now proceed (in synthetic transaction, then rolled back).
      await expect(
        executor().withTransaction(async (tx) => {
          await tx.query("UPDATE reviews SET repository_id=$1 WHERE id=$2", [otherRepoId, reviewId]);
          const changed = (await tx.query("SELECT repository_id FROM reviews WHERE id=$1", [reviewId])) as {
            rows: Array<{ repository_id: string }>;
          };
          expect(changed.rows[0]?.repository_id).toBe(otherRepoId);
          throw new Error("rollback-unpublished-reparent");
        }),
      ).rejects.toThrow("rollback-unpublished-reparent");
    } finally {
      await executor().query("DELETE FROM reviews WHERE id=$1", [reviewId]);
      await executor().query("DELETE FROM installations WHERE id=$1", [otherInstallId]);
    }
  });

  it("fences pending-to-running erasure transitions without blocking another tenant's artifact ingest", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    const pendingErasureId = randomUUID();
    const unrelatedInstallationId = randomUUID();
    const unrelatedRepositoryId = randomUUID();
    const unrelatedRunId = randomUUID();
    const unrelatedArtifactId = randomUUID();
    const unrelatedTenant = `unrelated-${randomUUID()}`;
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'synthetic','user',$2,'pending',FALSE)",
      [pendingErasureId, tenant],
    );
    try {
      await executor().query(
        "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
        [
          unrelatedInstallationId,
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
          unrelatedTenant,
          9876543222,
        ],
      );
      await executor().query(
        "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at) VALUES($1,$2,$3,$4,'other-private','main',NOW())",
        [
          unrelatedRepositoryId,
          unrelatedInstallationId,
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
          unrelatedTenant,
        ],
      );
      await executor().query(
        "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
        [unrelatedRunId, unrelatedRepositoryId, "b".repeat(40)],
      );
      let entered: (() => void) | undefined;
      let end: (() => void) | undefined;
      const enteredWrite = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const completeWrite = new Promise<void>((resolve) => {
        end = resolve;
      });
      const active = checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
        underLock: async () => {
          entered?.();
          await completeWrite;
        },
      });
      await enteredWrite;
      try {
        await expect(
          executor().withTransaction(async (tx) => {
            await tx.query("SET LOCAL statement_timeout='250ms'");
            await tx.query("UPDATE erasure_requests SET status='running' WHERE id=$1", [pendingErasureId]);
          }),
        ).rejects.toMatchObject({ code: "57014" });
        const stillPending = await rows("SELECT status FROM erasure_requests WHERE id=$1", [pendingErasureId]);
        expect(stillPending[0]?.status).toBe("pending");
        await executor().query(
          "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until) VALUES($1,$2,'manufacturing','other.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')",
          [unrelatedArtifactId, unrelatedRunId, `artifacts/${unrelatedArtifactId}.bin`, digest, contents.length],
        );
        expect((await rows("SELECT id FROM artifacts WHERE id=$1", [unrelatedArtifactId])).length).toBe(1);
      } finally {
        end?.();
        expect(await active).toBe("eligible");
      }
      await executor().query("UPDATE erasure_requests SET status='running' WHERE id=$1", [pendingErasureId]);
      let invoked = false;
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [object],
          underLock: async () => {
            invoked = true;
          },
        }),
      ).toBe("stale");
      expect(invoked).toBe(false);
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [pendingErasureId]);
      await executor().query("DELETE FROM installations WHERE id=$1", [unrelatedInstallationId]);
    }
  });

  it("denies the second localhost HTTP chunk after an original-user export revocation", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    const first = Buffer.from("first-publication-preflight-only");
    const forbidden = Buffer.from("must-never-reach-transport");
    let wroteSecond = false;
    const server = createServer((_request, response) => {
      void (async () => {
        try {
          const admitted = await checkHistoricalUserArchivePrepublication({
            db: executor(),
            authority,
            objects: [object],
            underLock: async () => writePrivateExportHttpChunk(response, first),
          });
          if (admitted !== "eligible") throw new Error("Original USER first chunk unexpectedly denied");
          // Simulate requester revocation AFTER first socket acknowledgement.
          await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
          const revoked = await checkHistoricalUserArchivePrepublication({
            db: executor(),
            authority,
            objects: [object],
            underLock: async () => {
              wroteSecond = true;
              await writePrivateExportHttpChunk(response, forbidden);
            },
          });
          if (revoked !== "stale") throw new Error("Revoked original USER transport was accepted");
          response.end();
        } catch (error) {
          response.destroy(error instanceof Error ? error : new Error("Local transport test failed"));
        }
      })();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const received = await new Promise<Buffer>((resolve, reject) => {
        const request = get(`http://127.0.0.1:${address.port}/source-only-test`, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.once("end", () => resolve(Buffer.concat(chunks)));
          response.once("error", reject);
        });
        request.once("error", reject);
      });
      expect(received).toEqual(first);
      expect(wroteSecond).toBe(false);
    } finally {
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8000);

  it("rolls back transfer admission on sink failure and never treats partial bytes as delivery", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!object) throw new Error("Missing original USER fixture");
    await expect(
      checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
        underLock: async () => {
          throw new Error("synthetic disconnected private sink");
        },
      }),
    ).rejects.toThrow("synthetic disconnected private sink");
    // The failed transfer's transaction MUST NOT retain a row lock.
    const lock = await rows("SELECT id FROM data_exports WHERE id=$1 FOR UPDATE NOWAIT", [exportId]);
    expect(lock).toHaveLength(1);
    expect(
      await checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [object],
      }),
    ).toBe("eligible");
  });

  it("fails busy rather than clearing a concurrent legal-hold writer", async () => {
    const original = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    if (!original) throw new Error("Missing original USER object");
    let unblock: (() => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = executor().withTransaction(
      async (tx) => {
        await tx.query("LOCK TABLE legal_holds IN ROW EXCLUSIVE MODE");
        started?.();
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
      },
      { statementTimeoutMs: 5_000 },
    );
    await ready;
    try {
      expect(
        await checkHistoricalUserArchivePrepublication({
          db: executor(),
          authority,
          objects: [original],
        }),
      ).toBe("busy");
    } finally {
      unblock?.();
      await pending;
    }
    expect(
      await checkHistoricalUserArchivePrepublication({
        db: executor(),
        authority,
        objects: [original],
      }),
    ).toBe("eligible");
  });

  it("rejects wrong user identity, missing artifacts, and live rather than suspended installation", async () => {
    expect(
      await lookupHistoricalUserExportObject(
        executor(),
        {
          ...authority,
          verifiedGitHubUserId: githubUserId + 1,
        },
        artifactId,
      ),
    ).toBeNull();
    expect(
      await lookupHistoricalUserExportObject(
        executor(),
        {
          ...authority,
          exportId: randomUUID(),
        },
        artifactId,
      ),
    ).toBeNull();
    expect(await lookupHistoricalUserExportObject(executor(), authority, randomUUID())).toBeNull();
    expect(await lookupHistoricalUserExportObject(executor(), authority, "unsafe/../id")).toBeNull();
    await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
    try {
      expect(await read()).toBeNull();
    } finally {
      await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
    }
  });

  it("excludes a different numeric GitHub user even under a recycled identical login", async () => {
    const otherInstallation = randomUUID();
    const otherRepository = randomUUID();
    const otherRun = randomUUID();
    const otherArtifact = randomUUID();
    await executor().query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
      [
        otherInstallation,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        tenant,
        githubUserId + 999,
      ],
    );
    try {
      await executor().query(
        "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'lookalike-private','main')",
        [
          otherRepository,
          otherInstallation,
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
          tenant,
        ],
      );
      await executor().query(
        "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
        [otherRun, otherRepository, "b".repeat(40)],
      );
      await executor().query(
        "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until) VALUES($1,$2,'manufacturing','other.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')",
        [otherArtifact, otherRun, objectPath, digest, contents.length],
      );
      expect(await lookupHistoricalUserExportObject(executor(), authority, otherArtifact)).toBeNull();
      expect(
        await readVerifiedHistoricalUserLocalObject({
          db: executor(),
          authority,
          artifactId: otherArtifact,
          storageRoot,
          storageDriver: "local",
        }),
      ).toBeNull();
      expect((await read())?.bytes.equals(contents)).toBe(true);
    } finally {
      await executor().query("DELETE FROM installations WHERE id=$1", [otherInstallation]);
    }
  });

  it("drops bytes when the export is revoked after physical IO but before the final authority check", async () => {
    let lookups = 0;
    const probe = {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes("SELECT a.id, a.run_id")) {
          lookups += 1;
          if (lookups === 3) {
            await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
          }
        }
        return executor().query(sql, params);
      },
    };
    try {
      expect(
        await readVerifiedHistoricalUserLocalObject({
          db: probe,
          authority,
          artifactId,
          storageRoot,
          storageDriver: "local",
        }),
      ).toBeNull();
      expect(lookups).toBe(3);
      const active = await rows(
        "SELECT count(*)::integer AS count FROM artifact_export_copy_reservations WHERE export_id=$1 AND released_at IS NULL",
        [exportId],
      );
      expect(active[0]?.count).toBe(0);
    } finally {
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    }
  });

  it("rejects tampered same-size bytes; refuses duplicate unresolved reservations", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    expect(object).not.toBeNull();
    if (!object) return;
    const reservation = await reserveHistoricalUserObjectCopy(executor(), authority, object);
    expect(reservation).not.toBeNull();
    if (!reservation) return;
    try {
      expect(await reserveHistoricalUserObjectCopy(executor(), authority, object)).toBeNull();
      expect(await read()).toBeNull();
    } finally {
      await releaseHistoricalUserObjectCopy(executor(), authority, reservation);
    }
    await writeFile(join(storageRoot, objectPath), Buffer.alloc(contents.length, 42));
    try {
      expect(await read()).toBeNull();
    } finally {
      await writeFile(join(storageRoot, objectPath), contents);
    }
    expect((await read())?.bytes.equals(contents)).toBe(true);
  });

  it("denies expired retention and revoked/completed request independently", async () => {
    await executor().query(
      "UPDATE artifacts SET uploaded_at=NOW()-INTERVAL '2 days', retention_until=NOW()-INTERVAL '1 second' WHERE id=$1",
      [artifactId],
    );
    try {
      expect(await read()).toBeNull();
    } finally {
      await executor().query(
        "UPDATE artifacts SET uploaded_at=NOW(),retention_until=NOW()+INTERVAL '1 day' WHERE id=$1",
        [artifactId],
      );
    }
    await executor().query("UPDATE data_exports SET status='failed' WHERE id=$1", [exportId]);
    try {
      expect(await read()).toBeNull();
    } finally {
      await executor().query("UPDATE data_exports SET status='pending' WHERE id=$1", [exportId]);
    }
    const erasureId = randomUUID();
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,status,dry_run) VALUES($1,$2,'system','organization','completed',FALSE)",
      [erasureId, tenant],
    );
    try {
      expect(await read()).toBeNull();
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    }
    expect((await read())?.bytes.equals(contents)).toBe(true);
  });

  it("refuses to disclose an original USER storage locator after export expiry, hold, or real erasure", async () => {
    const previous = (await rows("SELECT expires_at FROM data_exports WHERE id=$1", [exportId]))[0]?.expires_at ?? null;
    const holdId = randomUUID();
    const erasureId = randomUUID();
    const lookup = () => lookupHistoricalUserExportObject(executor(), authority, artifactId);
    try {
      expect(await lookup()).not.toBeNull();
      await executor().query("UPDATE data_exports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exportId]);
      expect(await lookup()).toBeNull();
      await executor().query("UPDATE data_exports SET expires_at=$2 WHERE id=$1", [exportId, previous]);
      expect(await lookup()).not.toBeNull();

      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Original USER locator review','user',$2)",
        [holdId, tenant.toUpperCase()],
      );
      expect(await lookup()).toBeNull();
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);

      await executor().query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','repository',$3,'running',TRUE)",
        [erasureId, tenant, repositoryId],
      );
      expect(await lookup()).not.toBeNull();
      await executor().query("UPDATE erasure_requests SET dry_run=FALSE WHERE id=$1", [erasureId]);
      expect(await lookup()).toBeNull();
      await executor().query("UPDATE erasure_requests SET status='completed',completed_at=NOW() WHERE id=$1", [
        erasureId,
      ]);
      expect(await lookup()).toBeNull();
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
      await executor().query("UPDATE data_exports SET expires_at=$2 WHERE id=$1", [exportId, previous]);
    }
    expect(await lookup()).not.toBeNull();
    expect((await read())?.bytes.equals(contents)).toBe(true);
  });

  it("holds queued physical deletion until read finishes and refuses new reads of a deletion job", async () => {
    const object = await lookupHistoricalUserExportObject(executor(), authority, artifactId);
    expect(object).not.toBeNull();
    if (!object) return;
    const reservation = await reserveHistoricalUserObjectCopy(executor(), authority, object);
    expect(reservation).not.toBeNull();
    if (!reservation) return;
    const jobId = randomUUID();
    try {
      await executor().query(
        "INSERT INTO artifact_deletion_jobs(id,artifact_id,installation_id,repository_id,release_run_id,storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes,available_at,created_at) VALUES($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,$8,NOW()-INTERVAL '1 second',NOW())",
        [jobId, randomUUID(), installationId, repositoryId, runId, objectPath, digest, contents.length],
      );
      const deletionStore = createSqlArtifactDeletionStore(executor());
      const claimed = await deletionStore.claimDeletions({ workerId: "history-deletion-worker", limit: 100 });
      expect(claimed.some((job) => job.deletionJobId === jobId)).toBe(true);
      expect(
        await deletionStore.beginPhysicalDeletion({
          deletionJobId: jobId,
          workerId: "history-deletion-worker",
          fenceToken: randomUUID(),
        }),
      ).toBe("held");
      expect(await read()).toBeNull();
    } finally {
      await releaseHistoricalUserObjectCopy(executor(), authority, reservation);
    }
    expect(await read()).toBeNull();
  });
});
