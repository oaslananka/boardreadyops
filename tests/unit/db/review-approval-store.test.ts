import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  type ReviewApprovalRecord,
  ReviewApprovalStore,
  type ReviewChecklistItemRecord,
} from "../../../packages/db/src/review-approval-store.js";

describe("ReviewApprovalStore", () => {
  it("records approvals and invalidates on digest change", async () => {
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
        .mockResolvedValueOnce([{ id: "rapp_1" }]),
    };

    const store = new ReviewApprovalStore(mockExecutor);

    const recorded = await store.recordApproval({
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

    const count = await store.invalidateApprovalsOnDigestChange("rev-1", "b".repeat(64));
    expect(count).toBe(1);
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE review_approvals"),
      expect.arrayContaining(["rev-1", "b".repeat(64)]),
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
});
