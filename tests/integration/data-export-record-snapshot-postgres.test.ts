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
import {
  ExportReviewCommentsSnapshotUnavailableError,
  prepareClaimedReviewCommentsSnapshot,
} from "../../packages/db/src/data-export-review-comments-snapshot.js";
import {
  ExportReviewWorkflowSnapshotUnavailableError,
  prepareClaimedReviewWorkflowSnapshot,
} from "../../packages/db/src/data-export-review-workflow-snapshot.js";
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
  it("prepares six partial scopes within one read-only snapshot without publishing an export", async () => {
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    const prepared = await prepareClaimedConsistentMetadataSlices(executor(), claim);
    expect(prepared).not.toBeNull();
    const repositories = JSON.parse(prepared?.repositories.bytes.toString("utf8") ?? "{}");
    const records = JSON.parse(prepared?.records.bytes.toString("utf8") ?? "{}");
    const reviewAudit = JSON.parse(prepared?.reviewAudit.bytes.toString("utf8") ?? "{}");
    expect(reviewAudit.reviews).toEqual([]);
    expect(reviewAudit.revisions).toEqual([]);
    expect(JSON.parse(prepared?.reviewComments.bytes.toString("utf8") ?? "{}").comments).toEqual([]);
    const workflow = JSON.parse(prepared?.reviewWorkflow.bytes.toString("utf8") ?? "{}");
    expect(workflow.approvals).toEqual([]);
    expect(workflow.checklistItems).toEqual([]);
    const finding = JSON.parse(prepared?.findingCollaboration.bytes.toString("utf8") ?? "{}");
    expect(finding.decisions).toEqual([]);
    expect(finding.assignments).toEqual([]);
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

  it("includes only authorized review comments and preserves all source fields", async () => {
    const rollback = "comment-export-validation-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewIds = [randomUUID(), randomUUID(), randomUUID()];
        for (let i = 0; i < 3; i++) {
          await tx.query(
            `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
          VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
            [reviewIds[i], repository[i], runId[i]],
          );
        }
        const parentId = randomUUID();
        const childId = randomUUID();
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        VALUES($1,$2,$3,'actor','Parent comment')`,
          [parentId, repository[0], reviewIds[0]],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,parent_id,author_id,content,
        finding_fingerprint,evidence_anchor,created_at,updated_at)
        VALUES($1,$2,$3,$4,'actor','Child comment','fp-synthetic','evidence-synthetic',
          '2026-10-01T01:02:03Z'::timestamptz,'2026-10-02T01:02:03Z'::timestamptz)`,
          [childId, repository[0], reviewIds[0], parentId],
        );
        const alien = [randomUUID(), randomUUID()];
        for (let i = 1; i < 3; i++) {
          await tx.query(
            `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
          VALUES($1,$2,$3,'actor','OUT_OF_SCOPE')`,
            [alien[i - 1], repository[i], reviewIds[i]],
          );
        }
        const output = await prepareClaimedReviewCommentsSnapshot(tx, claim);
        const data = JSON.parse(output?.bytes.toString("utf8") ?? "{}");
        expect(data.comments.map((v: { id: string }) => v.id).sort()).toEqual([parentId, childId].sort());
        expect(data.comments).toContainEqual(
          expect.objectContaining({
            id: childId,
            parentId,
            findingFingerprint: "fp-synthetic",
            evidenceAnchor: "evidence-synthetic",
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          }),
        );
        const child = data.comments.find((v: { id: string }) => v.id === childId);
        expect(new Date(child.createdAt).toISOString()).toBe("2026-10-01T01:02:03.000Z");
        expect(new Date(child.updatedAt).toISOString()).toBe("2026-10-02T01:02:03.000Z");
        for (const forbidden of [...alien, "OUT_OF_SCOPE"])
          expect(output?.bytes.toString("utf8")).not.toContain(forbidden);
        expect(await prepareClaimedReviewCommentsSnapshot(tx, { ...claim, token: "invalid" })).toBeNull();
        const joined = await prepareClaimedConsistentMetadataSlices(executor(), claim);
        expect(joined?.reviewComments.sha256).toMatch(/^[0-9a-f]{64}$/u);
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("fails closed on a mismatched repository in an otherwise authorized review", async () => {
    const rollback = "comment-mismatch-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewId = randomUUID();
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        VALUES($1,$2,$3,'actor','mismatched repository')`,
          [randomUUID(), repository[1], reviewId],
        );
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("preserves valid empty optional evidence in PostgreSQL without weakening overflow checks", async () => {
    const rollback = "comment-empty-evidence-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const [reviewId, commentId] = [randomUUID(), randomUUID()];
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content,
        finding_fingerprint,evidence_anchor) VALUES($1,$2,$3,'actor','valid empty','', '')`,
          [commentId, repository[0], reviewId],
        );
        const snap = await prepareClaimedReviewCommentsSnapshot(tx, claim);
        const decoded = JSON.parse(snap?.bytes.toString("utf8") ?? "{}");
        expect(decoded.comments).toContainEqual(
          expect.objectContaining({ id: commentId, findingFingerprint: "", evidenceAnchor: "" }),
        );
        await tx.query(`UPDATE review_comments SET evidence_anchor=repeat('x',2049) WHERE id=$1`, [commentId]);
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects a comment whose parent belongs to a different review in the same authorized repository", async () => {
    const rollback = "cross-review-parent-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const [firstReview, secondReview, parent, child] = Array.from({ length: 4 }, () => randomUUID());
        for (const id of [firstReview, secondReview]) {
          await tx.query(
            `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
          VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
            [id, repository[0], runId[0]],
          );
        }
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        VALUES($1,$2,$3,'actor','parent')`,
          [parent, repository[0], firstReview],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,parent_id,author_id,content)
        VALUES($1,$2,$3,$4,'actor','cross-review child')`,
          [child, repository[0], secondReview, parent],
        );
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects cyclic review comment parent links in PostgreSQL", async () => {
    const rollback = "parent-cycle-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const [reviewId, first, second] = Array.from({ length: 3 }, () => randomUUID());
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        for (const id of [first, second]) {
          await tx.query(
            `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
          VALUES($1,$2,$3,'actor','cycle')`,
            [id, repository[0], reviewId],
          );
        }
        await tx.query(`UPDATE review_comments SET parent_id=$2 WHERE id=$1`, [first, second]);
        await tx.query(`UPDATE review_comments SET parent_id=$2 WHERE id=$1`, [second, first]);
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects 101 scoped comments rather than returning a partial export", async () => {
    const rollback = "comment-count-overflow-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewId = randomUUID();
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        SELECT $1 || '-' || number::text, $2, $3, 'actor', 'bounded comment'
        FROM generate_series(1,101) AS number`,
          [randomUUID(), repository[0], reviewId],
        );
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects a PostgreSQL JSON aggregate over 256 KiB without returning truncated data", async () => {
    const rollback = "comment-bytes-overflow-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewId = randomUUID();
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic review','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        await tx.query(
          `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        SELECT $1 || '-' || number::text, $2, $3, 'actor', repeat('x',60000)
        FROM generate_series(1,5) AS number`,
          [randomUUID(), repository[0], reviewId],
        );
        await expect(prepareClaimedReviewCommentsSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewCommentsSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("returns no comments when the original installation becomes suspended", async () => {
    const rollback = "comment-suspension-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        await tx.query(`UPDATE installations SET suspended_at=NOW() WHERE id=$1`, [installation[0]]);
        expect(await prepareClaimedReviewCommentsSnapshot(tx, claim)).toBeNull();
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("includes only claim-scoped approvals and checklist entries with revision provenance", async () => {
    const rollback = "workflow-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviews = Array.from({ length: 3 }, () => randomUUID());
        const revisions = Array.from({ length: 3 }, () => randomUUID());
        const approvals = Array.from({ length: 3 }, () => randomUUID());
        const checklist = Array.from({ length: 3 }, () => randomUUID());
        for (let i = 0; i < 3; i++) {
          await tx.query(
            `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
          VALUES($1,$2,'Synthetic','completed','approved',$3)`,
            [reviews[i], repository[i], runId[i]],
          );
          await tx.query(
            `INSERT INTO review_revisions(id,review_id,sequence,head_run_id,head_commit_sha,evidence_digest)
          VALUES($1,$2,1,$3,$4,$5)`,
            [revisions[i], reviews[i], runId[i], "a".repeat(40), "b".repeat(64)],
          );
          await tx.query(
            `INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,
          approver_id,status,reason,is_break_glass) VALUES($1,$2,$3,$4,$5,'reviewer','approved','Synthetic approval',false)`,
            [approvals[i], repository[i], reviews[i], revisions[i], "b".repeat(64)],
          );
          await tx.query(
            `INSERT INTO review_checklist_items(id,repository_id,review_id,title,completed,completed_by,completed_at)
          VALUES($1,$2,$3,'Synthetic checklist',true,'reviewer',NOW())`,
            [checklist[i], repository[i], reviews[i]],
          );
        }
        const result = await prepareClaimedReviewWorkflowSnapshot(tx, claim);
        const json = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
        expect(json.approvals).toEqual([
          expect.objectContaining({
            id: approvals[0],
            repositoryId: repository[0],
            reviewId: reviews[0],
            revisionId: revisions[0],
            reason: "Synthetic approval",
            evidenceDigest: "b".repeat(64),
            isBreakGlass: false,
          }),
        ]);
        expect(json.checklistItems).toEqual([
          expect.objectContaining({
            id: checklist[0],
            reviewId: reviews[0],
            completed: true,
            completedBy: "reviewer",
            completedAt: expect.any(String),
          }),
        ]);
        for (const value of [...approvals.slice(1), ...checklist.slice(1)])
          expect(result?.bytes.toString("utf8")).not.toContain(value);
        expect(await prepareClaimedReviewWorkflowSnapshot(tx, { ...claim, token: "invalid" })).toBeNull();
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("fails closed on mismatched approval repository or forged revision", async () => {
    const rollback = "invalid-approval-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewId = randomUUID();
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        const badApproval = randomUUID();
        await tx.query(
          `INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,
        approver_id,status) VALUES($1,$2,$3,$4,$5,'reviewer','approved')`,
          [badApproval, repository[1], reviewId, randomUUID(), "b".repeat(64)],
        );
        await expect(prepareClaimedReviewWorkflowSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewWorkflowSnapshotUnavailableError,
        );
        await tx.query(`UPDATE review_approvals SET repository_id=$2 WHERE id=$1`, [badApproval, repository[0]]);
        await expect(prepareClaimedReviewWorkflowSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewWorkflowSnapshotUnavailableError,
        );
        const revisionId = randomUUID();
        await tx.query(
          `INSERT INTO review_revisions(id,review_id,sequence,base_run_id,head_run_id,
          head_commit_sha,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6)`,
          [revisionId, reviewId, runId[1], runId[0], "a".repeat(40), "b".repeat(64)],
        );
        await tx.query(`UPDATE review_approvals SET revision_id=$2 WHERE id=$1`, [badApproval, revisionId]);
        await expect(prepareClaimedReviewWorkflowSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewWorkflowSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("fails closed on checklist repository mismatch", async () => {
    const rollback = "invalid-checklist-rollback";
    const claim = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await expect(
      executor().withTransaction(async (tx) => {
        const reviewId = randomUUID();
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
        VALUES($1,$2,'Synthetic','completed','approved',$3)`,
          [reviewId, repository[0], runId[0]],
        );
        await tx.query(
          `INSERT INTO review_checklist_items(id,repository_id,review_id,title)
        VALUES($1,$2,$3,'Synthetic')`,
          [randomUUID(), repository[1], reviewId],
        );
        await expect(prepareClaimedReviewWorkflowSnapshot(tx, claim)).rejects.toThrow(
          ExportReviewWorkflowSnapshotUnavailableError,
        );
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
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
