import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import { loadServerReview } from "../../../apps/web/lib/server-review-loader.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import type { PcbFootprintSummary } from "../../../packages/contracts/src/pcb-footprint-summary.js";

const query = vi.fn();
const close = vi.fn();
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor: vi.fn(() => ({ query, close })) }));
vi.mock("../../../packages/db/src/pg-executor.js", () => ({ createPgQueryExecutor: vi.fn(() => ({ query, close })) }));

const summary: PcbFootprintSummary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: "a".repeat(40),
  headCommitSha: "b".repeat(40),
  baseBlobSha: "c".repeat(40),
  headBlobSha: "d".repeat(40),
  baseSourceSha256: "e".repeat(64),
  headSourceSha256: "f".repeat(64),
  changes: {
    added: 0,
    removed: 1,
    modified: 1,
    byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 1, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
};
const summaryDigest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
const now = new Date().toISOString();
const allowed: UserSession = {
  userId: 1001,
  login: "alice",
  installationIds: [47001],
  issuedAt: now,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const denied: UserSession = { ...allowed, installationIds: [99999] };

describe("private Review PCB summary visibility", () => {
  beforeEach(() => {
    query.mockReset();
    close.mockReset();
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://test/db",
    });
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.toLowerCase().replace(/\s+/g, " ");
      if (normalized.includes("from reviews join repositories"))
        return {
          rows: [
            {
              id: "private-review",
              repository_id: "private-repo",
              pull_request_number: 25,
              title: "Private PCB",
              status: "active",
              decision: "pending",
              base_run_id: null,
              head_run_id: "run-1",
              current_revision_id: "revision-1",
              created_by: "test",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "private",
              name: "pcb",
              private: true,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "private",
            },
          ],
        };
      if (normalized.includes("from github_marketplace_subscriptions")) return { rows: [] };
      if (normalized.includes("from review_revisions where id = $1 and review_id = $2"))
        return {
          rows: [
            {
              id: "revision-1",
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-1",
              base_commit_sha: summary.baseCommitSha,
              head_commit_sha: summary.headCommitSha,
              evidence_digest: "0".repeat(64),
            },
          ],
        };
      if (normalized.includes("from run_pcb_footprint_summaries")) {
        expect(params).toEqual(["run-1", "private-repo", summary.baseCommitSha, summary.headCommitSha]);
        return { rows: [{ summary, summary_sha256: summaryDigest }] };
      }
      return { rows: [] };
    });
  });

  it("loads only bound summary evidence after canonical private viewer authorization", async () => {
    const result = await loadServerReview("private-review", allowed);
    expect(result?.pcbFootprintSummary).toEqual(summary);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("from run_pcb_footprint_summaries"))).toBe(true);
  });

  it("does not query or disclose summary evidence to an unauthorized installation", async () => {
    expect(await loadServerReview("private-review", denied)).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("from run_pcb_footprint_summaries"))).toBe(false);
  });
});
