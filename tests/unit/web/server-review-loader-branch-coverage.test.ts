import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import { loadServerReview } from "../../../apps/web/lib/server-review-loader.js";

const query = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

const reviewId = "rev_branch_coverage";
const revisionId = "rrev_branch_coverage";
const runId = "run_branch_coverage";
const now = "2026-08-28T22:00:00.000Z";

function postgresMode() {
  vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
    mode: "postgres",
    databaseUrl: "postgresql://localhost/boardreadyops",
  });
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: reviewId,
    repository_id: "repo_branch_coverage",
    pull_request_number: null,
    title: "Branch coverage review",
    status: "active",
    decision: "pending",
    base_run_id: null,
    head_run_id: runId,
    current_revision_id: revisionId,
    created_by: "reviewer@example.com",
    created_at: now,
    updated_at: now,
    completed_at: null,
    owner: "acme",
    name: "controller",
    private: false,
    disabled_at: null,
    suspended_at: null,
    github_installation_id: "47001",
    account_login: "acme",
    ...overrides,
  };
}

function revisionRow() {
  return {
    id: revisionId,
    sequence: 3,
    base_run_id: null,
    head_run_id: runId,
    base_commit_sha: null,
    head_commit_sha: "1".repeat(40),
    evidence_digest: "e".repeat(64),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  query.mockReset();
  close.mockReset();
  close.mockResolvedValue(undefined);
});

describe("server review loader branch coverage", () => {
  it("maps canonical severities, evidence fallbacks, collaboration deduplication, and optional governance fields", async () => {
    postgresMode();
    query.mockImplementation(async (sql: string) => {
      const normalized = sql.toLowerCase().replace(/\s+/g, " ");
      if (normalized.includes("from reviews join repositories")) {
        return { rows: [reviewRow()] };
      }
      if (normalized.includes("from github_marketplace_subscriptions")) {
        return { rows: [] };
      }
      if (normalized.includes("from review_revisions")) {
        return { rows: [revisionRow()] };
      }
      if (normalized.includes("from findings where run_id")) {
        return {
          rows: [
            {
              id: "finding-critical",
              rule_id: "rule.critical",
              severity: "critical",
              message: "Critical finding",
              path: "board.kicad_pcb",
              kind: "drc",
              fingerprint: null,
            },
            {
              id: "finding-warning",
              rule_id: "rule.warning",
              severity: "warning",
              message: "Warning finding",
              path: "board.kicad_sch",
              kind: "erc",
              fingerprint: "fp-warning",
            },
            {
              id: "finding-unknown",
              rule_id: "rule.unknown",
              severity: "notice",
              message: "Informational finding",
              path: "README.md",
              kind: "policy",
              fingerprint: "fp-unknown",
            },
          ],
        };
      }
      if (normalized.includes("from finding_decisions")) {
        return {
          rows: [
            {
              finding_fingerprint: "finding-critical",
              disposition: "accepted_risk",
              reason: "Accepted after independent verification.",
              owner: "safety@example.com",
              expires_at: "2027-01-01T00:00:00.000Z",
            },
            {
              finding_fingerprint: "finding-critical",
              disposition: "fixed",
              reason: "Older decision must not replace newest one.",
              owner: "old@example.com",
              expires_at: null,
            },
            {
              finding_fingerprint: "fp-warning",
              disposition: "fixed",
              reason: null,
              owner: null,
              expires_at: null,
            },
          ],
        };
      }
      if (normalized.includes("from finding_assignments")) {
        return {
          rows: [
            { finding_fingerprint: "finding-critical", assignee: "alice@example.com" },
            { finding_fingerprint: "finding-critical", assignee: "alice@example.com" },
            { finding_fingerprint: "finding-critical", assignee: "bob@example.com" },
          ],
        };
      }
      if (normalized.includes("from artifacts")) {
        return {
          rows: [
            { id: "a-bom", kind: "bom", name: "bom.csv", role: null, bytes: 10, sha256: "a".repeat(64) },
            {
              id: "a-sch",
              kind: "schematic",
              name: "design.kicad_sch",
              role: null,
              bytes: "20",
              sha256: "b".repeat(64),
            },
            { id: "a-report", kind: "report", name: "report.html", role: null, bytes: 30, sha256: "c".repeat(64) },
            { id: "a-net", kind: "netlist", name: "net.xml", role: null, bytes: 40, sha256: "d".repeat(64) },
            { id: "a-role", kind: "", name: "model.step", role: "step", bytes: 50, sha256: "e".repeat(64) },
            { id: "a-fallback", kind: "", name: "manifest.json", role: null, bytes: "invalid", sha256: null },
          ],
        };
      }
      if (normalized.includes("from review_approvals")) {
        return {
          rows: [
            {
              id: "approval-break-glass",
              approver_id: "chief@example.com",
              status: "approved",
              reason: null,
              is_break_glass: true,
              evidence_digest: "e".repeat(64),
              created_at: now,
            },
          ],
        };
      }
      if (normalized.includes("from review_checklist_items")) {
        return {
          rows: [
            {
              id: "check-open",
              title: "Confirm manufacturing package",
              completed: false,
              completed_by: null,
              completed_at: null,
            },
          ],
        };
      }
      if (normalized.includes("from review_comments")) {
        return {
          rows: [
            {
              id: "comment-stale",
              parent_id: "comment-parent",
              author_id: "reviewer@example.com",
              author_type: "internal",
              content: "Superseded by newer evidence.",
              status: "stale",
              finding_fingerprint: "finding-critical",
              evidence_anchor: "a-report",
              created_at: now,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const review = await loadServerReview(reviewId);

    expect(review).not.toBeNull();
    expect(review?.pullRequestNumber).toBe(0);
    expect(review?.baseCommitSha).toBe("0".repeat(40));
    expect(review?.findings.map((finding) => finding.severity)).toEqual(["critical", "warning", "info"]);
    expect(review?.findings[0]).toMatchObject({
      fingerprint: "finding-critical",
      disposition: "accepted_risk",
      decisionReason: "Accepted after independent verification.",
      decisionOwner: "safety@example.com",
      decisionExpiresAt: "2027-01-01T00:00:00.000Z",
      assignees: ["alice@example.com", "bob@example.com"],
    });
    expect(review?.findings[1]).not.toHaveProperty("decisionReason");
    expect(review?.evidenceItems.map((item) => item.type)).toEqual([
      "bom",
      "schematic",
      "drc",
      "netlist",
      "pcb",
      "manifest",
    ]);
    expect(review?.evidenceItems.at(-1)).toMatchObject({ sha256: "0".repeat(64), sizeBytes: 0 });
    expect(review?.approvals[0]).toMatchObject({ isBreakGlass: true });
    expect(review?.approvals[0]).not.toHaveProperty("reason");
    expect(review?.checklist[0]).not.toHaveProperty("completedBy");
    expect(review?.checklist[0]).not.toHaveProperty("completedAt");
    expect(review?.comments[0]).toMatchObject({
      parentId: "comment-parent",
      status: "outdated",
      findingFingerprint: "finding-critical",
      evidenceAnchor: "a-report",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed for suspended installations, invalid installation ids, missing revisions, and reviews without a current revision", async () => {
    postgresMode();

    query.mockResolvedValueOnce({ rows: [reviewRow({ suspended_at: now })] });
    expect(await loadServerReview("rev-suspended")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);

    query.mockReset();
    query.mockResolvedValueOnce({ rows: [reviewRow({ github_installation_id: "not-a-number" })] });
    expect(await loadServerReview("rev-invalid-installation")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);

    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [reviewRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await loadServerReview("rev-missing-revision")).toBeNull();
    expect(query).toHaveBeenCalledTimes(3);

    query.mockReset();
    query.mockResolvedValueOnce({ rows: [reviewRow({ current_revision_id: null })] });
    expect(await loadServerReview("rev-no-current-revision")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("serves demo fixtures without PostgreSQL and keeps unknown memory-mode reviews closed", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({ mode: "memory" });

    const gatewayReview = await loadServerReview("rev_gateway_42");
    expect(gatewayReview?.id).toBe("rev_gateway_42");
    expect(gatewayReview?.headSnapshots).toBeDefined();

    const memoryReview = await loadServerReview("rev_gateway_42");
    expect(memoryReview?.id).toBe("rev_gateway_42");

    expect(await loadServerReview("rev_unknown_memory_review")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
