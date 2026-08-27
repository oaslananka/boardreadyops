import { describe, expect, it, vi } from "vitest";
import { type FindingDecisionRecord, FindingDecisionStore } from "../../../packages/db/src/finding-decision-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

describe("FindingDecisionStore", () => {
  it("enforces 20-character reason check on accepted_risk disposition", async () => {
    const mockExecutor: SqlQueryExecutor = {
      query: vi.fn(),
    };

    const store = new FindingDecisionStore(mockExecutor);

    await expect(
      store.recordDecision({
        repositoryId: "repo-1",
        reviewId: "rev-1",
        findingFingerprint: "fp-123",
        disposition: "accepted_risk",
        reason: "too short", // < 20 chars
        owner: "engineer@company.com",
        evidenceDigest: "a".repeat(64),
        actorId: "actor-1",
      }),
    ).rejects.toThrow("Accepted risk disposition requires a justification reason of at least 20 characters");
  });

  it("persists accepted_risk decision with valid justification", async () => {
    const mockDecision: FindingDecisionRecord = {
      id: "fdec_123",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-123",
      disposition: "accepted_risk",
      reason: "This high thermal dissipation was reviewed and heat sink is provided on chassis.",
      owner: "engineer@company.com",
      expiresAt: null,
      evidenceDigest: "a".repeat(64),
      actorId: "actor-1",
      createdAt: new Date().toISOString(),
    };

    const mockExecutor: SqlQueryExecutor = {
      query: vi.fn().mockResolvedValueOnce([mockDecision]),
    };

    const store = new FindingDecisionStore(mockExecutor);
    const result = await store.recordDecision({
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-123",
      disposition: "accepted_risk",
      reason: "This high thermal dissipation was reviewed and heat sink is provided on chassis.",
      owner: "engineer@company.com",
      evidenceDigest: "a".repeat(64),
      actorId: "actor-1",
    });

    expect(result.id).toBe("fdec_123");
    expect(result.disposition).toBe("accepted_risk");
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO finding_decisions"),
      expect.any(Array),
    );
  });

  it("queries latest decisions grouped by fingerprint", async () => {
    const mockDecisions: FindingDecisionRecord[] = [
      {
        id: "fdec_2",
        repositoryId: "repo-1",
        reviewId: "rev-1",
        findingFingerprint: "fp-123",
        disposition: "false_positive",
        reason: "Silkscreen is deliberately overlapped on ground test pad.",
        owner: "engineer@company.com",
        expiresAt: null,
        evidenceDigest: "a".repeat(64),
        actorId: "actor-1",
        createdAt: new Date().toISOString(),
      },
    ];

    const mockExecutor: SqlQueryExecutor = {
      query: vi.fn().mockResolvedValueOnce(mockDecisions),
    };

    const store = new FindingDecisionStore(mockExecutor);
    const map = await store.getLatestDecisionsByReviewId("rev-1");

    expect(map.get("fp-123")?.disposition).toBe("false_positive");
    expect(mockExecutor.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT DISTINCT ON (finding_fingerprint)"),
      ["rev-1"],
    );
  });
});
