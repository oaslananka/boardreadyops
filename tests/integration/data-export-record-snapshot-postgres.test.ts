import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareClaimedConsistentMetadataSlices } from "../../packages/db/src/data-export-consistent-snapshot.js";
import { lookupClaimedExportObject } from "../../packages/db/src/data-export-object-authorization.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import {
  ExportRecordSnapshotUnavailableError,
  prepareClaimedRunFindingSnapshot,
} from "../../packages/db/src/data-export-record-snapshot.js";
import { prepareClaimedReviewAuditSnapshot } from "../../packages/db/src/data-export-review-audit-snapshot.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `export-snapshot-${randomUUID()}`;
const installation: [string, string] = [randomUUID(), randomUUID()];
const repository: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const runId: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const findingId: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
let exportId: string;
let token: string;

function executor() {
  if (!db) throw new Error("Test requires isolated PostgreSQL");
  return db;
}

beforeAll(async () => {
  if (!db) return;
  for (let index = 0; index < installation.length; index++) {
    await db.query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
      [installation[index], Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
    );
  }
  for (const [index, repoId] of repository.entries()) {
    await db.query(
      "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,$5,'main')",
      [
        repoId,
        installation[index === 2 ? 1 : 0],
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        tenant,
        `board-${index}`,
      ],
    );
    await db.query(
      "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
      [runId[index], repoId, "a".repeat(40)],
    );
    await db.query(
      "INSERT INTO findings(id,run_id,rule_id,severity,message,path,kind) VALUES($1,$2,$3,'warning',$4,'board.kicad_pcb','erc')",
      [findingId[index], runId[index], `rule-${index}`, `private finding ${index}`],
    );
  }
  const id = await new DataExportPreparationStore(db).createBoundPendingExport({
    tenantId: tenant,
    installationId: installation[0],
    requestedBy: "operator",
    scope: "repository",
    scopeId: repository[0],
  });
  if (!id) throw new Error("Expected bound export");
  exportId = id;
  const claim = await new DataExportPreparationStore(db).claimNext({
    installationId: installation[0],
    workerId: "snapshot-worker",
  });
  if (!claim || claim.exportId !== id) throw new Error("Expected original lease");
  token = claim.token;
});

afterAll(async () => {
  if (!db) return;
  try {
    if (exportId) await db.query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [installation]);
  } finally {
    await db.close();
  }
});

describeDatabase("claimed run/finding snapshot PostgreSQL isolation", () => {
  it("prepares three partial scopes within one read-only snapshot without publishing an export", async () => {
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    const prepared = await prepareClaimedConsistentMetadataSlices(executor(), claim);
    expect(prepared).not.toBeNull();
    const repositories = JSON.parse(prepared?.repositories.bytes.toString("utf8") ?? "{}");
    const records = JSON.parse(prepared?.records.bytes.toString("utf8") ?? "{}");
    const reviewAudit = JSON.parse(prepared?.reviewAudit.bytes.toString("utf8") ?? "{}");
    const artifactMetadata = JSON.parse(prepared?.artifactMetadata.bytes.toString("utf8") ?? "{}");
    expect(artifactMetadata.artifacts).toEqual([]);
    expect(artifactMetadata.exclusions).toContain("artifact-contents");
    expect(reviewAudit.reviews).toEqual([]);
    expect(reviewAudit.revisions).toEqual([]);
    expect(reviewAudit.auditEvents).toEqual([]);
    expect(repositories.repositories).toEqual([expect.objectContaining({ repositoryId: repository[0] })]);
    expect(records.runs).toEqual([expect.objectContaining({ repositoryId: repository[0] })]);
    expect(records.findings).toEqual([expect.objectContaining({ runId: runId[0] })]);
    expect(await prepareClaimedConsistentMetadataSlices(executor(), { ...claim, token: "wrong-token" })).toBeNull();
    expect(
      await prepareClaimedConsistentMetadataSlices(executor(), { ...claim, installationId: installation[1] }),
    ).toBeNull();
    const current = await executor().query("SELECT status, download_url, completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((current as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("isolates repository review and audit evidence under the original export claim", async () => {
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    const rollbackMarker = "review-audit-evidence-rollback";
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewIds = [randomUUID(), randomUUID(), randomUUID()];
        const auditIds = [randomUUID(), randomUUID(), randomUUID()];
        const revisionIds = [randomUUID(), randomUUID(), randomUUID()];
        for (const [i, reviewId] of reviewIds.entries()) {
          await tx.query(
            `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
            VALUES($1,$2,$3,'completed','approved',$4)`,
            [reviewId, repository[i], `sensitive-review-${i}`, runId[i]],
          );
          await tx.query(
            `INSERT INTO review_revisions(id,review_id,sequence,head_run_id,head_commit_sha,evidence_digest)
              VALUES($1,$2,1,$3,$4,$5)`,
            [revisionIds[i], reviewId, runId[i], "a".repeat(40), "b".repeat(64)],
          );
          await tx.query(
            `INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type,subject_id,repository_id,release_run_id,metadata)
            VALUES($1,$2,'review.approved','system','review',$3,$4,$5,$6::jsonb)`,
            [
              auditIds[i],
              installation[i === 2 ? 1 : 0],
              reviewId,
              repository[i],
              runId[i],
              JSON.stringify({ notForExport: `audit-secret-${i}` }),
            ],
          );
        }
        const result = await prepareClaimedReviewAuditSnapshot(tx, claim);
        expect(result).not.toBeNull();
        const data = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
        expect(data.reviews).toEqual([expect.objectContaining({ id: reviewIds[0], repositoryId: repository[0] })]);
        expect(data.revisions).toEqual([
          expect.objectContaining({ id: revisionIds[0], reviewId: reviewIds[0], headRunId: runId[0] }),
        ]);
        expect(data.auditEvents).toEqual([expect.objectContaining({ id: auditIds[0], repositoryId: repository[0] })]);
        for (const privatePart of [
          reviewIds[1],
          reviewIds[2],
          auditIds[1],
          auditIds[2],
          revisionIds[1],
          revisionIds[2],
          "audit-secret-0",
          "audit-secret-1",
          "audit-secret-2",
        ]) {
          expect(result?.bytes.toString("utf8")).not.toContain(privatePart);
        }
        expect(await prepareClaimedReviewAuditSnapshot(tx, { ...claim, token: "wrong" })).toBeNull();
        expect(await prepareClaimedReviewAuditSnapshot(tx, { ...claim, installationId: installation[1] })).toBeNull();
        throw new Error(rollbackMarker);
      }),
    ).rejects.toThrow(rollbackMarker);
  });

  it("excludes other repositories and other installations sharing the same tenant", async () => {
    const input = {
      exportId,
      tenantId: tenant,
      installationId: installation[0],
      workerId: "snapshot-worker",
      token,
    };
    const record = await prepareClaimedRunFindingSnapshot(executor(), input);
    expect(record?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record?.byteLength).toBeGreaterThan(0);
    const decoded = JSON.parse(record?.bytes.toString("utf8") ?? "{}");
    expect(decoded).toMatchObject({
      exportId,
      coverage: "active-installation-release-runs-and-findings-only",
      runs: [{ id: runId[0], repositoryId: repository[0] }],
      findings: [{ id: findingId[0], runId: runId[0], message: "private finding 0" }],
    });
    for (const phrase of [runId[1], runId[2], findingId[1], findingId[2], "storage_path"]) {
      expect(record?.bytes.toString("utf8")).not.toContain(phrase);
    }
    expect(await prepareClaimedRunFindingSnapshot(executor(), { ...input, token: "stolen-token" })).toBeNull();
    expect(
      await prepareClaimedRunFindingSnapshot(executor(), { ...input, installationId: installation[1] }),
    ).toBeNull();
    expect(await prepareClaimedRunFindingSnapshot(executor(), { ...input, tenantId: "different-tenant" })).toBeNull();
  });

  it("authorizes only unexpired, installation-bound physical objects without a deletion fence", async () => {
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    const artifactIds: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
    const digest = "a".repeat(64);
    const artifactPaths = artifactIds.map((id) => `synthetic/${id}.bin`);
    for (const [index, id] of artifactIds.entries()) {
      await executor().query(
        `INSERT INTO artifacts(id,run_id,kind,name,storage_path,sha256,bytes,role,retention_until)
         VALUES($1,$2,'archive','example.bin',$3,$4,22,'primary',NOW()+interval '3 days')`,
        [id, runId[index], artifactPaths[index], digest],
      );
    }
    try {
      const active = await lookupClaimedExportObject(executor(), claim, artifactIds[0]);
      expect(active).toMatchObject({
        artifactId: artifactIds[0],
        runId: runId[0],
        repositoryId: repository[0],
        storagePath: artifactPaths[0],
      });
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[1])).toBeNull();
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[2])).toBeNull();
      expect(
        await lookupClaimedExportObject(executor(), { ...claim, token: "stolen-claim" }, artifactIds[0]),
      ).toBeNull();
      expect(
        await lookupClaimedExportObject(executor(), { ...claim, installationId: installation[1] }, artifactIds[0]),
      ).toBeNull();

      await executor().query("UPDATE artifacts SET retention_until=NULL WHERE id=$1", [artifactIds[0]]);
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[0])).toBeNull();
      await executor().query(
        "UPDATE artifacts SET uploaded_at=NOW()-interval '2 days',retention_until=NOW()-interval '1 day' WHERE id=$1",
        [artifactIds[0]],
      );
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[0])).toBeNull();
      await executor().query("UPDATE artifacts SET retention_until=NOW()+interval '3 days' WHERE id=$1", [
        artifactIds[0],
      ]);
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[0])).not.toBeNull();

      await executor().query(
        `INSERT INTO artifact_deletion_jobs(artifact_id,installation_id,repository_id,release_run_id,storage_driver,
          storage_path,deletion_reason,artifact_kind,artifact_role,artifact_sha256,artifact_bytes)
         VALUES($1,$2,$3,$4,'local',$5,'retention_expired','archive','primary',$6,22)`,
        [artifactIds[0], installation[0], repository[0], runId[0], artifactPaths[0], digest],
      );
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[0])).toBeNull();
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE artifact_id=$1", [artifactIds[0]]);
      expect(await lookupClaimedExportObject(executor(), claim, artifactIds[0])).not.toBeNull();
    } finally {
      await executor().query("DELETE FROM artifact_deletion_jobs WHERE artifact_id=ANY($1::text[])", [artifactIds]);
      await executor().query("DELETE FROM artifacts WHERE id=ANY($1::text[])", [artifactIds]);
    }
  });

  it("denies disabled repository, suspended installation, and expired original lease", async () => {
    const input = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await executor().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repository[0]]);
    try {
      expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
    } finally {
      await executor().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repository[0]]);
    }
    await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installation[0]]);
    try {
      expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
    } finally {
      await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installation[0]]);
    }
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [
      exportId,
    ]);
    expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
  });

  it("fails instead of silently dropping 101 authorized records", async () => {
    const input = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()+interval '2 minutes' WHERE id=$1", [
      exportId,
    ]);
    await executor().query(
      `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
        SELECT gen_random_uuid()::text,$1,$2,'refs/heads/main','manual','completed'
        FROM generate_series(1,101)`,
      [repository[0], "b".repeat(40)],
    );
    await expect(prepareClaimedRunFindingSnapshot(executor(), input)).rejects.toThrow(
      ExportRecordSnapshotUnavailableError,
    );
    const state = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((state as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });
});
