import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadAuthorizedRemoteFootprintSummary } from "../../../apps/web/lib/remote-mcp-footprint.js";

const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const base = "a".repeat(40);
const head = "b".repeat(40);
const summary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: base,
  headCommitSha: head,
  baseBlobSha: "c".repeat(40),
  headBlobSha: "d".repeat(40),
  baseSourceSha256: "e".repeat(64),
  headSourceSha256: "f".repeat(64),
  changes: {
    added: 1,
    removed: 0,
    modified: 1,
    byField: { reference: 1, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
} as const;
const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
const principal = { githubUserId: 123, grantId: "grant", scopes: ["review:read"] };
const reviewRow = {
  id: reviewId,
  repository_id: "internal-private-repository",
  head_run_id: "head-run",
  current_revision_id: "rev-1",
  status: "active",
  decision: "pending",
  owner: "PRIVATE_OWNER",
  name: "PRIVATE_REPOSITORY",
  github_repo_id: "456",
  github_installation_id: "789",
};
function store(
  options: { revokedAt?: number; replacedHead?: boolean; base?: string | null; stored?: object | null } = {},
) {
  let reviewReads = 0;
  const query = vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("from reviews")) {
      reviewReads++;
      return {
        rows: [{ ...reviewRow, ...(options.replacedHead && reviewReads === 2 ? { head_run_id: "new-run" } : {}) }],
      };
    }
    if (sql.includes("from review_revisions")) {
      return {
        rows: [
          {
            head_commit_sha: head,
            base_commit_sha: options.base === undefined ? base : options.base,
            evidence_digest: "9".repeat(64),
          },
        ],
      };
    }
    if (sql.includes("from run_pcb_footprint_summaries")) {
      expect(params).toEqual(["head-run", reviewRow.repository_id, base, head]);
      return { rows: options.stored === null ? [] : [{ summary: options.stored ?? summary, summary_sha256: digest }] };
    }
    throw new Error("Unexpected query");
  });
  return { query };
}

describe("hosted MCP footprint summary is scoped to the current Review", () => {
  it("returns only previously consented client-reported counts/digests for an authorized current run", async () => {
    const db = store();
    const grant = vi.fn().mockResolvedValue(true);
    const facts = await loadAuthorizedRemoteFootprintSummary(db, principal, reviewId, grant);
    expect(facts).toEqual({ availability: "client-reported", summary });
    expect(grant).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(facts)).not.toContain("PRIVATE_OWNER");
    expect(JSON.stringify(facts)).not.toContain("PRIVATE_REPOSITORY");
    expect(JSON.stringify(facts)).not.toContain("internal-private-repository");
    expect(db.query.mock.calls.filter(([sql]) => sql.includes("from run_pcb_footprint_summaries"))).toHaveLength(1);
  });

  it("reports absent or corrupted stored evidence as unavailable, not zero changed components", async () => {
    for (const options of [{ stored: null }, { stored: { ...summary, sourceText: "PRIVATE PCB" } }, { base: null }]) {
      const db = store(options);
      const value = await loadAuthorizedRemoteFootprintSummary(
        db,
        principal,
        reviewId,
        vi.fn().mockResolvedValue(true),
      );
      expect(value).toEqual({ availability: "unavailable", riskAssessment: "not-evaluated" });
    }
  });

  it("fails closed if live GitHub access is revoked during the summary read", async () => {
    const permission = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await loadAuthorizedRemoteFootprintSummary(store(), principal, reviewId, permission)).toBeNull();
    expect(permission).toHaveBeenCalledTimes(2);
  });

  it("rejects changed current Review head across asynchronous storage I/O", async () => {
    expect(
      await loadAuthorizedRemoteFootprintSummary(
        store({ replacedHead: true }),
        principal,
        reviewId,
        vi.fn().mockResolvedValue(true),
      ),
    ).toBeNull();
  });

  it("rejects evidence-only grants before any datastore read", async () => {
    const db = store();
    const access = vi.fn();
    expect(
      await loadAuthorizedRemoteFootprintSummary(db, { ...principal, scopes: ["evidence:read"] }, reviewId, access),
    ).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });
});
