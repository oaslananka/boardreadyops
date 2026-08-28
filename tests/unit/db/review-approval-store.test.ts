import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  type ReviewApprovalRecord,
  ReviewApprovalStore,
  type ReviewChecklistItemRecord,
} from "../../../packages/db/src/review-approval-store.js";

describe("ReviewApprovalStore", () => {
  it("records approvals atomically with CTE and invalidates on digest change", async () => {
    const mockApproval: ReviewApprovalRecord = {
      id: "rapp_1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      revisionId: "rev-rev-1",
      evidenceDigest: "a".repeat(64),
      approverId: "alice",
      status: "approved",
      reason: "All clearances verified.",
      isBreakGlass: false,
      invalidatedAt: null,
      invalidatedBy: null,
      invalidationReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([mockApproval])
        .mockResolvedValueOnce([{ id: "rapp_1" }])
        .mockResolvedValueOnce([mockApproval]),
    };

    const store = new ReviewApprovalStore(mockExecutor);

    const recorded = await store.recordApprovalAndTransitionDecision({
      repositoryId: "repo-1",
      reviewId: "rev-1",
      revisionId: "rev-rev-1",
      evidenceDigest: "a".repeat(64),
      approverId: "alice",
      status: "approved",
      reason: "All clearances verified.",
    });

    expect(recorded.id).toBe("rapp_1");
    expect(recorded.status).toBe("approved");
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("claim_approval AS ("),
      expect.arrayContaining(["repo-1", "rev-1", "rev-rev-1", "a".repeat(64), "alice", "approved"]),
    );

    const count = await store.invalidateApprovalsOnDigestChange("rev-1", "b".repeat(64));
    expect(count).toBe(1);
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE review_approvals"),
      expect.arrayContaining(["rev-1", "b".repeat(64)]),
    );

    const approvals = await store.listApprovalsForReview("rev-1", "repo-1");
    expect(approvals).toHaveLength(1);
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("AND repository_id = $2"),
      expect.arrayContaining(["rev-1", "repo-1"]),
    );
  });

  it("manages checklist items", async () => {
    const mockItem: ReviewChecklistItemRecord = {
      id: "rchk_1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      title: "Verify mounting hole ground stitching",
      completed: false,
      completedBy: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
    };

    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([mockItem])
        .mockResolvedValueOnce([{ ...mockItem, completed: true, completedBy: "alice" }]),
    };

    const store = new ReviewApprovalStore(mockExecutor);
    const item = await store.addChecklistItem({
      repositoryId: "repo-1",
      reviewId: "rev-1",
      title: "Verify mounting hole ground stitching",
    });

    expect(item.completed).toBe(false);

    const updated = await store.updateChecklistItem("rchk_1", true, "alice");
    expect(updated?.completed).toBe(true);
    expect(updated?.completedBy).toBe("alice");
  });

  it("throws ApprovalConflictError when claim_approval yields zero rows and existing active decision exists", async () => {
    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([]) // claim_approval returns 0 rows due to conflict
        .mockResolvedValueOnce([{ id: "rapp_existing" }]), // existing active decision check returns row
    };

    const store = new ReviewApprovalStore(mockExecutor);
    await expect(
      store.recordApprovalAndTransitionDecision({
        repositoryId: "repo-1",
        reviewId: "rev-1",
        revisionId: "rev-rev-1",
        evidenceDigest: "a".repeat(64),
        approverId: "alice",
        status: "approved",
        reason: "Conflicting reason",
      }),
    ).rejects.toThrow("Conflicting approval payload for active decision");
  });

  it("throws Error when claim_approval yields zero rows and no active review exists", async () => {
    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([]) // claim_approval returns 0 rows
        .mockResolvedValueOnce([]), // existing check returns 0 rows (missing review)
    };

    const store = new ReviewApprovalStore(mockExecutor);
    await expect(
      store.recordApprovalAndTransitionDecision({
        repositoryId: "repo-1",
        reviewId: "rev-1",
        revisionId: "rev-rev-1",
        evidenceDigest: "a".repeat(64),
        approverId: "alice",
        status: "approved",
      }),
    ).rejects.toThrow("Failed to record approval: review not found for repository");
  });
});
