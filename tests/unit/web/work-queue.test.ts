import { describe, expect, it, vi } from "vitest";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import { loadAssignedFindings, loadViewerWorkQueue } from "../../../apps/web/lib/work-queue.js";

vi.mock("@boardreadyops/db", () => {
  class ReviewCollaborationStore {
    getAssignmentsForAssignee = vi.fn(async (assignee: string) =>
      assignee === "octocat"
        ? [
            { repositoryId: "repo_1", reviewId: "rev_1", findingFingerprint: "fp_open" },
            { repositoryId: "repo_1", reviewId: "rev_1", findingFingerprint: "fp_decided" },
            { repositoryId: "repo_1", reviewId: "rev_missing", findingFingerprint: "fp_x" },
          ]
        : [],
    );
  }
  class ReviewStore {
    getReviewById = vi.fn(async (_repositoryId: string, reviewId: string) =>
      reviewId === "rev_1" ? { headRunId: "run_1" } : null,
    );
    getFindingsForRun = vi.fn(async () => [
      {
        fingerprint: "fp_open",
        rule_id: "drc.clearance",
        severity: "error",
        message: "Too close",
        path: "a.kicad_pcb",
      },
      { fingerprint: "fp_decided", rule_id: "bom.eol", severity: "high", message: "EOL part", path: null },
    ]);
  }
  class FindingDecisionStore {
    getLatestDecisionsByReviewId = vi.fn(async () => new Map([["fp_decided", { disposition: "accepted_risk" }]]));
  }
  return { ReviewCollaborationStore, ReviewStore, FindingDecisionStore };
});

const executor = {} as never;

describe("loadAssignedFindings", () => {
  it("keeps only assignments that still need a decision", async () => {
    const findings = await loadAssignedFindings(executor, "octocat");
    expect(findings.map((finding) => finding.fingerprint)).toEqual(["fp_open"]);
    expect(findings[0]).toMatchObject({ ruleId: "drc.clearance", severity: "error", reviewId: "rev_1" });
  });

  it("skips assignments whose review no longer resolves instead of failing the whole queue", async () => {
    const findings = await loadAssignedFindings(executor, "octocat");
    expect(findings.some((finding) => finding.reviewId === "rev_missing")).toBe(false);
  });

  it("returns nothing for a login with no assignments", async () => {
    await expect(loadAssignedFindings(executor, "someone-else")).resolves.toEqual([]);
  });
});

describe("loadViewerWorkQueue", () => {
  const session = { login: "octocat", installationIds: [1] } as unknown as UserSession;

  it("returns an empty queue rather than throwing when there is no database", async () => {
    await expect(loadViewerWorkQueue(session, {})).resolves.toEqual({ assignedFindings: [] });
  });

  it("returns an empty queue for a signed-out viewer", async () => {
    await expect(loadViewerWorkQueue(undefined, { DATABASE_URL: "postgres://x/y" })).resolves.toEqual({
      assignedFindings: [],
    });
  });
});
