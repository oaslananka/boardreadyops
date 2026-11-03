import { describe, expect, it, vi } from "vitest";
import { loadAuthorizedRemoteEvidence } from "../../../apps/web/lib/remote-mcp-evidence.js";

const evidenceId = "c68e521d-fc45-4dfa-942d-776e9fe76838";
const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const headSha = "a".repeat(40);
const baseSha = "c".repeat(40);
const digest = "b".repeat(64);
const principal = { githubUserId: 123, grantId: "test-grant", scopes: ["evidence:read"] };
const reviewRow = {
  id: reviewId,
  repository_id: "private-repository-id",
  head_run_id: "head-run",
  current_revision_id: evidenceId,
  status: "active",
  decision: "pending",
  owner: "PRIVATE_OWNER",
  name: "PRIVATE_REPOSITORY",
  github_repo_id: "456",
  github_installation_id: "789",
};

function fixture(
  options: {
    resolvedReviewId?: string | null;
    currentRevisionId?: string;
    secondHead?: string;
    secondDigest?: string;
    secondDecision?: string;
    baseCommitSha?: string | null;
  } = {},
) {
  let reviewsRead = 0;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("from review_revisions as requested_revision")) {
      expect(params).toEqual([evidenceId]);
      return { rows: options.resolvedReviewId === null ? [] : [{ review_id: options.resolvedReviewId ?? reviewId }] };
    }
    if (sql.includes("from reviews")) {
      reviewsRead++;
      return {
        rows: [
          {
            ...reviewRow,
            current_revision_id: options.currentRevisionId ?? evidenceId,
            ...(reviewsRead === 2 && options.secondDecision ? { decision: options.secondDecision } : {}),
          },
        ],
      };
    }
    if (sql.includes("from review_revisions")) {
      return {
        rows: [
          {
            head_commit_sha: reviewsRead === 2 && options.secondHead ? options.secondHead : headSha,
            base_commit_sha: options.baseCommitSha === undefined ? baseSha : options.baseCommitSha,
            evidence_digest: reviewsRead === 2 && options.secondDigest ? options.secondDigest : digest,
          },
        ],
      };
    }
    throw new Error("Unexpected query");
  });
  return { query };
}

describe("remote MCP evidence metadata: authorized current Review revision only", () => {
  it("returns allowlisted digest, source identity and authorized in-app Review link for an evidence-only grant", async () => {
    const db = fixture();
    const permission = vi.fn().mockResolvedValue(true);
    const result = await loadAuthorizedRemoteEvidence(db, principal, evidenceId, permission);
    expect(result).toEqual({
      schemaVersion: 1,
      availability: "recorded",
      source: "hosted-review-revision",
      evidenceId,
      headCommitSha: headSha,
      baseCommitSha: baseSha,
      evidenceDigest: digest,
      inAppUrl: `https://boardreadyops.com/reviews/${reviewId}`,
      verification: "recorded-metadata-only",
      productionApproval: "not-evaluated",
    });
    expect(permission).toHaveBeenCalledTimes(2);
    expect(permission).toHaveBeenCalledWith({
      githubUserId: 123,
      githubRepositoryId: 456,
      githubInstallationId: 789,
      owner: reviewRow.owner,
      name: reviewRow.name,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [reviewRow.owner, reviewRow.name, reviewRow.repository_id, "head-run"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("never returns historical revision evidence from an outdated/current Review link", async () => {
    const db = fixture({ currentRevisionId: "f46a29ab-0a2b-4dea-8d4f-27c629d677b6" });
    expect(await loadAuthorizedRemoteEvidence(db, principal, evidenceId, vi.fn().mockResolvedValue(true))).toBeNull();
  });

  it("treats missing IDs and inaccessible repository evidence identically", async () => {
    for (const options of [{ resolvedReviewId: null }, { resolvedReviewId: "untrusted" }]) {
      expect(
        await loadAuthorizedRemoteEvidence(fixture(options), principal, evidenceId, vi.fn().mockResolvedValue(true)),
      ).toBeNull();
    }
    const permission = vi.fn().mockResolvedValue(false);
    expect(await loadAuthorizedRemoteEvidence(fixture(), principal, evidenceId, permission)).toBeNull();
    expect(permission).toHaveBeenCalledTimes(1);
  });

  it("fails closed if repository access is revoked during an asynchronous evidence read", async () => {
    const permission = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await loadAuthorizedRemoteEvidence(fixture(), principal, evidenceId, permission)).toBeNull();
    expect(permission).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ secondHead: "d".repeat(40) }, "head commit"],
    [{ secondDigest: "e".repeat(64) }, "evidence digest"],
    [{ secondDecision: "approved" }, "Review decision"],
  ] as const)("rejects changed %s (%s) after the first snapshot", async (options) => {
    expect(
      await loadAuthorizedRemoteEvidence(fixture(options), principal, evidenceId, vi.fn().mockResolvedValue(true)),
    ).toBeNull();
  });

  it("does not invent a base revision on an initial Review", async () => {
    const result = await loadAuthorizedRemoteEvidence(
      fixture({ baseCommitSha: null }),
      principal,
      evidenceId,
      vi.fn().mockResolvedValue(true),
    );
    expect(result?.availability).toBe("recorded");
    expect(result).not.toHaveProperty("baseCommitSha");
  });

  it("denies review-only grants and malformed evidence IDs without any database lookup", async () => {
    const db = fixture();
    const permission = vi.fn();
    expect(
      await loadAuthorizedRemoteEvidence(db, { ...principal, scopes: ["review:read"] }, evidenceId, permission),
    ).toBeNull();
    expect(await loadAuthorizedRemoteEvidence(db, principal, "../../private", permission)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
  });
});
