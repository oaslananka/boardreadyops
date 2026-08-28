import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerReview } from "../../apps/web/lib/server-review-loader.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { ReviewApprovalStore } from "../../packages/db/src/review-approval-store.js";
import { ReviewCommentStore } from "../../packages/db/src/review-comment-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "88000000-0000-4000-8000-000000000001";
const repositoryId = "88000000-0000-4000-8000-000000000002";
const runId = "88000000-0000-4000-8000-000000000003";
const reviewId = "rev_durability_e2e_88";
const revisionId = "rev_seq_v1_88";
const evidenceDigest = "a".repeat(64);

const reviewBId = "rev_durability_b_88";
const revisionBId = "rev_seq_v1_b_88";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

describeDatabase("Review Durability & Atomic Approval Persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!executor) return;

    // Clean up any stale artifacts from prior runs
    await database().query(`DELETE FROM review_comments WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_checklist_items WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_approvals WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_revisions WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM reviews WHERE id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM artifacts WHERE run_id = $1`, [runId]);
    await database().query(`DELETE FROM release_runs WHERE id = $1`, [runId]);
    await database().query(`DELETE FROM repositories WHERE id = $1`, [repositoryId]);
    await database().query(`DELETE FROM installations WHERE id = $1`, [installationId]);

    // Setup installation and repository
    await database().query(
      `INSERT INTO installations (id, github_installation_id, account_login, account_type)
       VALUES ($1, 88001, 'durability-hardware-org', 'Organization')`,
      [installationId],
    );
    await database().query(
      `INSERT INTO repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
       VALUES ($1, $2, 88011, 'durability-hardware-org', 'power-inverter', 'main', false)`,
      [repositoryId, installationId],
    );

    // Setup release run
    await database().query(
      `INSERT INTO release_runs (
         id, repository_id, commit_sha, ref, pull_request_number, trigger_kind,
         status, decision, completed_at, duration_ms, readiness_score, trust_mode, safe_mode_reasons
       ) VALUES ($1, $2, $3, 'refs/heads/main', 55, 'pr', 'completed', 'pass', NOW(), 1200, 99,
                 'standard', array[]::text[])`,
      [runId, repositoryId, "1".repeat(40)],
    );

    // Setup artifact for evidence reconstruction check
    await database().query(
      `INSERT INTO artifacts (
         id, run_id, kind, name, storage_path, sha256, bytes, role, uploaded_at
       ) VALUES ($1, $2, 'gerber', 'gerbers.zip', 'internal/private/gerbers.zip', $3, 409600, 'gerber', NOW())`,
      ["art_durability_01", runId, "c".repeat(64)],
    );

    // Setup review record A in pending state
    await database().query(
      `INSERT INTO reviews (
         id, repository_id, pull_request_number, title, status, decision,
         head_run_id, current_revision_id, created_by, created_at, updated_at
       ) VALUES ($1, $2, 55, 'Power Inverter Stage Sign-Off', 'active', 'pending',
                 $3, $4, 'lead.eng@company.com', NOW(), NOW())`,
      [reviewId, repositoryId, runId, revisionId],
    );

    // Setup review revision A with valid evidence digest
    await database().query(
      `INSERT INTO review_revisions (
         id, review_id, sequence, head_run_id, base_commit_sha, head_commit_sha, evidence_digest, created_at
       ) VALUES ($1, $2, 1, $3, $4, $5, $6, NOW())`,
      [revisionId, reviewId, runId, "0".repeat(40), "1".repeat(40), evidenceDigest],
    );

    // Setup review record B (for cross-review IDOR testing)
    await database().query(
      `INSERT INTO reviews (
         id, repository_id, pull_request_number, title, status, decision,
         head_run_id, current_revision_id, created_by, created_at, updated_at
       ) VALUES ($1, $2, 56, 'Secondary Isolated Review B', 'active', 'pending',
                 $3, $4, 'other.eng@company.com', NOW(), NOW())`,
      [reviewBId, repositoryId, runId, revisionBId],
    );

    await database().query(
      `INSERT INTO review_revisions (
         id, review_id, sequence, head_run_id, base_commit_sha, head_commit_sha, evidence_digest, created_at
       ) VALUES ($1, $2, 1, $3, $4, $5, $6, NOW())`,
      [revisionBId, reviewBId, runId, "0".repeat(40), "2".repeat(40), "b".repeat(64)],
    );
  });

  afterAll(async () => {
    if (!executor) return;
    await database().query(`DELETE FROM review_comments WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_checklist_items WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_approvals WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM review_revisions WHERE review_id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM reviews WHERE id IN ($1, $2)`, [reviewId, reviewBId]);
    await database().query(`DELETE FROM artifacts WHERE run_id = $1`, [runId]);
    await database().query(`DELETE FROM release_runs WHERE id = $1`, [runId]);
    await database().query(`DELETE FROM repositories WHERE id = $1`, [repositoryId]);
    await database().query(`DELETE FROM installations WHERE id = $1`, [installationId]);
    await executor.close();
  });

  it("persists approval and transitions review decision atomically in a single statement", async () => {
    const store = new ReviewApprovalStore(database());

    const approval = await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: "senior.reviewer@company.com",
      status: "approved",
      reason: "High-voltage creepage verified per IPC-2221.",
      isBreakGlass: false,
    });

    expect(approval).toBeDefined();
    expect(approval.status).toBe("approved");
    expect(approval.approverId).toBe("senior.reviewer@company.com");

    // Verify directly in database that reviews table decision transitioned to 'approved'
    const reviewResult = await database().query(`SELECT decision FROM reviews WHERE id = $1`, [reviewId]);
    const rows = (reviewResult as { rows?: { decision: string }[] }).rows ?? [];
    expect(rows[0]?.decision).toBe("approved");
  });

  it("safely handles concurrent / duplicate approval requests with database-level idempotency", async () => {
    const store = new ReviewApprovalStore(database());

    // Send two identical concurrent approvals
    const [first, second] = await Promise.all([
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: "senior.reviewer@company.com",
        status: "approved",
        reason: "Retry attempt verified",
      }),
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: "senior.reviewer@company.com",
        status: "approved",
        reason: "Retry attempt verified",
      }),
    ]);

    expect(first.status).toBe("approved");
    expect(second.status).toBe("approved");
    expect(first.id).toBe(second.id);

    // Database should only have 1 active approval record for this approver & status
    const allApprovals = await store.listApprovalsForReview(reviewId, repositoryId);
    expect(
      allApprovals.filter(
        (a) => a.approverId === "senior.reviewer@company.com" && a.status === "approved" && !a.invalidatedAt,
      ),
    ).toHaveLength(1);
  });

  it("loadServerReview reconstructs the authoritative persisted review from PostgreSQL including artifacts", async () => {
    const session = {
      userId: 88001,
      login: "lead.eng",
      installationIds: [88001],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const review = await loadServerReview(reviewId, session);
    expect(review).toBeDefined();
    expect(review?.id).toBe(reviewId);
    expect(review?.decision).toBe("approved");
    expect(review?.evidenceDigest).toBe(evidenceDigest);
    expect(review?.approvals.length).toBeGreaterThanOrEqual(1);
    expect(review?.approvals[0]?.approverId).toBe("senior.reviewer@company.com");

    // Verify evidence item reconstructed from canonical artifacts table without leaking internal storage_path
    expect(review?.evidenceItems).toBeDefined();
    expect(review?.evidenceItems.length).toBeGreaterThanOrEqual(1);
    const gerber = review?.evidenceItems.find((e) => e.name === "gerbers.zip");
    expect(gerber).toBeDefined();
    expect(gerber?.path).toBe("artifacts/gerbers.zip");
    expect(gerber?.sizeBytes).toBe(409600);
    expect(gerber?.sha256).toBe("c".repeat(64));
  });

  it("enforces private review access control in loadServerReview", async () => {
    // Switch repository to private
    await database().query(`UPDATE repositories SET private = true WHERE id = $1`, [repositoryId]);

    // Unauthorized session
    const unauthorizedSession = {
      userId: 9999,
      login: "other",
      installationIds: [99999],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const denied = await loadServerReview(reviewId, unauthorizedSession);
    expect(denied).toBeNull();

    // Signed out (no session)
    const signedOut = await loadServerReview(reviewId, null);
    expect(signedOut).toBeNull();

    // Authorized session
    const authorizedSession = {
      userId: 88001,
      login: "lead.eng",
      installationIds: [88001],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const allowed = await loadServerReview(reviewId, authorizedSession);
    expect(allowed).toBeDefined();
    expect(allowed?.id).toBe(reviewId);

    // Restore repository to public
    await database().query(`UPDATE repositories SET private = false WHERE id = $1`, [repositoryId]);
  });

  it("enforces tenant and review scope on checklist item update to prevent cross-review IDOR", async () => {
    const store = new ReviewApprovalStore(database());

    // Create item on review B
    const itemB = await store.addChecklistItem({
      repositoryId,
      reviewId: reviewBId,
      title: "Isolated Review B Checklist Item",
    });
    expect(itemB.id).toBeDefined();
    expect(itemB.completed).toBe(false);

    // Attempt to update item B while scoped to review A -> must fail closed (return undefined)
    const crossUpdate = await store.updateChecklistItem(itemB.id, true, "attacker@company.com", {
      reviewId,
      repositoryId,
    });
    expect(crossUpdate).toBeUndefined();

    // Verify item B in database is completely unchanged
    const itemsB = await store.listChecklistItems(reviewBId);
    const reloadedItemB = itemsB.find((i) => i.id === itemB.id);
    expect(reloadedItemB?.completed).toBe(false);

    // Legitimate update scoped to review B -> succeeds
    const legitUpdate = await store.updateChecklistItem(itemB.id, true, "owner@company.com", {
      reviewId: reviewBId,
      repositoryId,
    });
    expect(legitUpdate).toBeDefined();
    expect(legitUpdate?.completed).toBe(true);
  });

  it("enforces tenant and review scope on comment status update to prevent cross-review IDOR", async () => {
    const store = new ReviewCommentStore(database());

    // Create comment on review B
    const commentB = await store.createComment({
      repositoryId,
      reviewId: reviewBId,
      authorId: "alice@company.com",
      content: "Sensitive observation on Review B",
    });
    expect(commentB.id).toBeDefined();
    expect(commentB.status).toBe("open");

    // Attempt to resolve comment B while scoped to review A -> must fail closed (return undefined)
    const crossUpdate = await store.updateCommentStatus(commentB.id, "resolved", {
      reviewId,
      repositoryId,
    });
    expect(crossUpdate).toBeUndefined();

    // Verify comment B in database is completely unchanged
    const commentsB = await store.listCommentsForReview(reviewBId);
    const reloadedCommentB = commentsB.find((c) => c.id === commentB.id);
    expect(reloadedCommentB?.status).toBe("open");

    // Legitimate update scoped to review B -> succeeds
    const legitUpdate = await store.updateCommentStatus(commentB.id, "resolved", {
      reviewId: reviewBId,
      repositoryId,
    });
    expect(legitUpdate).toBeDefined();
    expect(legitUpdate?.status).toBe("resolved");
  });

  it("supersedes previous opposing decisions atomically without deleting audit history", async () => {
    const store = new ReviewApprovalStore(database());

    // 1. Initial approval
    const app1 = await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: "auditor@company.com",
      status: "approved",
      reason: "Initial approval",
    });
    expect(app1.status).toBe("approved");

    // 2. Same approver changes mind and requests changes
    const app2 = await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: "auditor@company.com",
      status: "changes_requested",
      reason: "Found thermal relief violation on ground plane",
    });
    expect(app2.status).toBe("changes_requested");

    // Review decision in database transitioned to 'changes_requested'
    const reviewResult = await database().query(`SELECT decision FROM reviews WHERE id = $1`, [reviewId]);
    const rows = (reviewResult as { rows?: { decision: string }[] }).rows ?? [];
    expect(rows[0]?.decision).toBe("changes_requested");

    // Prior approval is now invalidated/superseded, not deleted
    const allApprovals = await store.listApprovalsForReview(reviewId, repositoryId);
    const auditorApprovals = allApprovals.filter((a) => a.approverId === "auditor@company.com");
    expect(auditorApprovals).toHaveLength(2);
    const activeAuditor = auditorApprovals.filter((a) => a.status === "changes_requested" && !a.invalidatedAt);
    expect(activeAuditor).toHaveLength(1);
    const supersededAuditor = auditorApprovals.filter((a) => a.status === "invalidated" && a.invalidatedAt);
    expect(supersededAuditor).toHaveLength(1);
  });

  it("causes zero database mutations when rejected with ApprovalConflictError", async () => {
    const store = new ReviewApprovalStore(database());
    const initialApprover = "zero.sideeffects@company.com";

    // 1. Establish initial active approval
    await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: initialApprover,
      status: "approved",
      reason: "Original established rationale",
    });

    const approvalsBefore = await store.listApprovalsForReview(reviewId, repositoryId);
    const reviewBeforeRes = await database().query(`SELECT decision, updated_at FROM reviews WHERE id = $1`, [
      reviewId,
    ]);
    const reviewBefore = (reviewBeforeRes as { rows: { decision: string; updated_at: string }[] }).rows[0];

    // 2. Attempt conflicting approval with different reason
    await expect(
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: initialApprover,
        status: "approved",
        reason: "Materially different conflicting reason",
      }),
    ).rejects.toThrow("Conflicting approval payload");

    // 3. Verify ZERO database mutations occurred
    const approvalsAfter = await store.listApprovalsForReview(reviewId, repositoryId);
    expect(approvalsAfter).toHaveLength(approvalsBefore.length);

    const reviewAfterRes = await database().query(`SELECT decision, updated_at FROM reviews WHERE id = $1`, [reviewId]);
    const reviewAfter = (reviewAfterRes as { rows: { decision: string; updated_at: string }[] }).rows[0];
    expect(reviewAfter?.decision).toBe(reviewBefore?.decision);
  });

  it("handles concurrent different-payload approval requests with exactly one winner", async () => {
    const store = new ReviewApprovalStore(database());
    const raceApprover = "racer.eng@company.com";

    // Clear prior approvals for this approver
    await database().query(`DELETE FROM review_approvals WHERE review_id = $1 AND approver_id = $2`, [
      reviewId,
      raceApprover,
    ]);

    const results = await Promise.allSettled([
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: raceApprover,
        status: "approved",
        reason: "Concurrent reason 1",
      }),
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: raceApprover,
        status: "approved",
        reason: "Concurrent reason 2",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain("Conflicting approval payload");

    // Exactly one active approval in database
    const activeRes = await database().query(
      `SELECT reason FROM review_approvals WHERE review_id = $1 AND approver_id = $2 AND status = 'approved' AND invalidated_at IS NULL`,
      [reviewId, raceApprover],
    );
    const activeRows = (activeRes as { rows: { reason: string }[] }).rows;
    expect(activeRows).toHaveLength(1);
  });

  it("handles concurrent identical approval requests with idempotent success", async () => {
    const store = new ReviewApprovalStore(database());
    const raceApprover = "idempotent.racer@company.com";

    await database().query(`DELETE FROM review_approvals WHERE review_id = $1 AND approver_id = $2`, [
      reviewId,
      raceApprover,
    ]);

    const results = await Promise.allSettled([
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: raceApprover,
        status: "approved",
        reason: "Identical rationale",
      }),
      store.recordApprovalAndTransitionDecision({
        repositoryId,
        reviewId,
        revisionId,
        evidenceDigest,
        approverId: raceApprover,
        status: "approved",
        reason: "Identical rationale",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    // Exactly one active approval in database
    const activeRes = await database().query(
      `SELECT id FROM review_approvals WHERE review_id = $1 AND approver_id = $2 AND status = 'approved' AND invalidated_at IS NULL`,
      [reviewId, raceApprover],
    );
    const activeRows = (activeRes as { rows: { id: string }[] }).rows;
    expect(activeRows).toHaveLength(1);
  });

  it("safely normalizes legacy duplicate active rows when executing migration 0057", async () => {
    const dupReviewId = "rev_legacy_dup_0057";
    const dupRevisionId = "rev_legacy_rev_0057";
    const dupApproverId = "legacy.reviewer@company.com";

    try {
      // 1. Seed full valid parent hierarchy for the legacy duplicate test
      await database().query(
        `INSERT INTO reviews (
           id, repository_id, pull_request_number, title, status, decision,
           head_run_id, current_revision_id, created_by, created_at, updated_at
         ) VALUES ($1, $2, 57, 'Legacy Duplicate Test Review', 'active', 'pending',
                   $3, $4, 'lead.eng@company.com', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [dupReviewId, repositoryId, runId, dupRevisionId],
      );

      await database().query(
        `INSERT INTO review_revisions (
           id, review_id, sequence, head_run_id, base_commit_sha, head_commit_sha, evidence_digest, created_at
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [dupRevisionId, dupReviewId, runId, "0".repeat(40), "1".repeat(40), evidenceDigest],
      );

      // 2. Drop unique index to simulate pre-0057 legacy state
      await database().query(`DROP INDEX IF EXISTS uq_review_approval_active_decision`);

      await database().query(`DELETE FROM review_approvals WHERE review_id = $1`, [dupReviewId]);

      // 3. Insert older duplicate active approval
      await database().query(
        `INSERT INTO review_approvals (
           id, repository_id, review_id, revision_id, evidence_digest,
           approver_id, status, reason, is_break_glass, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'Legacy older sign-off', false, NOW() - INTERVAL '10 minutes', NOW())`,
        ["rapp_legacy_old", repositoryId, dupReviewId, dupRevisionId, evidenceDigest, dupApproverId],
      );

      // 4. Insert newer duplicate active approval
      await database().query(
        `INSERT INTO review_approvals (
           id, repository_id, review_id, revision_id, evidence_digest,
           approver_id, status, reason, is_break_glass, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'Legacy newer sign-off', false, NOW(), NOW())`,
        ["rapp_legacy_new", repositoryId, dupReviewId, dupRevisionId, evidenceDigest, dupApproverId],
      );

      // 5. Read and run migration 0057 SQL
      const migrationSql = await readFile(
        join(process.cwd(), "packages/db/migrations/0057_review_approval_uniqueness.sql"),
        "utf8",
      );
      await database().query(migrationSql);

      // 6. Verify newer remains active
      const newRowRes = await database().query(
        `SELECT status, invalidated_at FROM review_approvals WHERE id = 'rapp_legacy_new'`,
      );
      const newRows = (newRowRes as { rows?: { status: string; invalidated_at: string | null }[] }).rows ?? [];
      expect(newRows[0]?.status).toBe("approved");
      expect(newRows[0]?.invalidated_at).toBeNull();

      // 7. Verify older was invalidated with migration reason and not deleted
      const oldRowRes = await database().query(
        `SELECT status, invalidated_at, invalidated_by, invalidation_reason FROM review_approvals WHERE id = 'rapp_legacy_old'`,
      );
      const oldRows =
        (
          oldRowRes as {
            rows?: {
              status: string;
              invalidated_at: string | null;
              invalidated_by: string | null;
              invalidation_reason: string | null;
            }[];
          }
        ).rows ?? [];
      expect(oldRows[0]?.status).toBe("invalidated");
      expect(oldRows[0]?.invalidated_at).not.toBeNull();
      expect(oldRows[0]?.invalidated_by).toBe("migration_0057");
      expect(oldRows[0]?.invalidation_reason).toBe("Deduplicated during schema v57 migration");
    } finally {
      // Guaranteed cleanup: ensure unique index exists and legacy rows are cleaned
      await database().query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_review_approval_active_decision
         ON review_approvals (review_id, revision_id, approver_id, status)
         WHERE status IN ('approved', 'changes_requested') AND invalidated_at IS NULL`,
      );
      await database().query(`DELETE FROM review_approvals WHERE review_id = $1`, [dupReviewId]);
      await database().query(`DELETE FROM review_revisions WHERE review_id = $1`, [dupReviewId]);
      await database().query(`DELETE FROM reviews WHERE id = $1`, [dupReviewId]);
    }
  });

  it("invalidates approvals when new evidence digest is introduced on revision bump", async () => {
    const store = new ReviewApprovalStore(database());
    const newDigest = "b".repeat(64);

    const invalidatedCount = await store.invalidateApprovalsOnDigestChange(
      reviewId,
      newDigest,
      "system",
      "Head commit changed",
    );
    expect(invalidatedCount).toBeGreaterThanOrEqual(1);

    // Verify approvals now reflect invalidated status
    const approvals = await store.listApprovalsForReview(reviewId, repositoryId);
    const active = approvals.filter((a) => a.status === "approved" && !a.invalidatedAt);
    expect(active).toHaveLength(0);
  });
});
