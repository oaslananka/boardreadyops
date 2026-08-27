import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { type ReviewCommentRecord, ReviewCommentStore } from "../../../packages/db/src/review-comment-store.js";

describe("ReviewCommentStore", () => {
  it("creates and updates review comments", async () => {
    const mockComment: ReviewCommentRecord = {
      id: "rcmt_1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      parentId: null,
      findingFingerprint: "fp-1",
      evidenceAnchor: null,
      authorId: "alice",
      authorType: "internal",
      content: "Please check the trace clearance here.",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([mockComment])
        .mockResolvedValueOnce([{ ...mockComment, status: "resolved" }]),
    };

    const store = new ReviewCommentStore(mockExecutor);

    const created = await store.createComment({
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-1",
      authorId: "alice",
      content: "Please check the trace clearance here.",
    });

    expect(created.id).toBe("rcmt_1");
    expect(created.status).toBe("open");

    const updated = await store.updateCommentStatus("rcmt_1", "resolved");
    expect(updated?.status).toBe("resolved");
  });
});
