import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  type FindingAssignmentRecord,
  ReviewCollaborationStore,
} from "../../../packages/db/src/review-collaboration-store.js";

describe("ReviewCollaborationStore", () => {
  it("assigns and unassigns findings", async () => {
    const mockAssignment: FindingAssignmentRecord = {
      id: "fasn_1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-1",
      assignee: "alice",
      assignedBy: "bob",
      createdAt: new Date().toISOString(),
    };

    const mockExecutor: SqlQueryExecutor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([mockAssignment])
        .mockResolvedValueOnce([{ id: "fasn_1" }]),
    };

    const store = new ReviewCollaborationStore(mockExecutor);

    const created = await store.assignFinding({
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-1",
      assignee: "alice",
      assignedBy: "bob",
    });

    expect(created.assignee).toBe("alice");

    const unassigned = await store.unassignFinding("rev-1", "fp-1", "alice");
    expect(unassigned).toBe(true);
  });

  it("groups assignments by finding fingerprint", async () => {
    const mockRows: FindingAssignmentRecord[] = [
      {
        id: "fasn_1",
        repositoryId: "repo-1",
        reviewId: "rev-1",
        findingFingerprint: "fp-1",
        assignee: "alice",
        assignedBy: "admin",
        createdAt: new Date().toISOString(),
      },
      {
        id: "fasn_2",
        repositoryId: "repo-1",
        reviewId: "rev-1",
        findingFingerprint: "fp-1",
        assignee: "charlie",
        assignedBy: "admin",
        createdAt: new Date().toISOString(),
      },
    ];

    const mockExecutor: SqlQueryExecutor = {
      query: vi.fn().mockResolvedValueOnce(mockRows),
    };

    const store = new ReviewCollaborationStore(mockExecutor);
    const grouped = await store.getAssignmentsGroupedByFinding("rev-1");

    expect(grouped.get("fp-1")).toEqual(["alice", "charlie"]);
  });
});
