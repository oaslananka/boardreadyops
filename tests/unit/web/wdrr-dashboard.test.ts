import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const mockQuery = vi.fn();
const mockClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

import { loadViewerWdrrWeekly, type WdrrDashboardDependencies } from "../../../apps/web/lib/wdrr-dashboard.js";

const session: UserSession = {
  userId: 1,
  login: "octo-org",
  installationIds: [4242],
  issuedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-02T00:00:00.000Z",
};

function noBlockersReadiness() {
  return {
    readiness: {
      decision: "approved" as const,
      isReady: true,
      blockers: [],
      approvedCount: 1,
      totalChecklistCount: 0,
      completedChecklistCount: 0,
      explanationGraph: { nodes: [], summary: "" },
      decisionFingerprint: "fp",
    },
  };
}

describe("loadViewerWdrrWeekly", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClose.mockReset();
  });

  it("returns an empty result for a signed-out viewer without querying the database", async () => {
    const result = await loadViewerWdrrWeekly(undefined, { DATABASE_URL: "postgresql://localhost/test" });
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns an empty result when no database is configured", async () => {
    const result = await loadViewerWdrrWeekly(session, {});
    expect(result).toEqual([]);
  });

  it("scopes the review window query to the session's installations", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await loadViewerWdrrWeekly(session, { DATABASE_URL: "postgresql://localhost/test" });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql.toLowerCase()).toContain("from reviews");
    expect(params[0]).toEqual([4242]);
  });

  it("counts a review as WDRR-ready only when checks completed, findings resolved, approvals present, and evidence recorded", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          review_id: "rev_1",
          repository_id: "repo_1",
          created_at: "2026-08-03T00:00:00.000Z",
          base_run_id: "run_base",
          head_run_id: "run_head",
          evidence_digest: "a".repeat(64),
          head_run_status: "completed",
        },
      ],
    });

    const dependencies: WdrrDashboardDependencies = {
      evaluateReviewReadiness: vi.fn().mockResolvedValue(noBlockersReadiness()),
    };

    const result = await loadViewerWdrrWeekly(session, { DATABASE_URL: "postgresql://localhost/test" }, dependencies);

    expect(result).toEqual([{ weekStart: "2026-08-03", count: 1 }]);
  });

  it("excludes a review whose head run has not completed, even with no finding/approval blockers", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          review_id: "rev_2",
          repository_id: "repo_1",
          created_at: "2026-08-03T00:00:00.000Z",
          base_run_id: "run_base",
          head_run_id: "run_head",
          evidence_digest: "a".repeat(64),
          head_run_status: "running",
        },
      ],
    });

    const dependencies: WdrrDashboardDependencies = {
      evaluateReviewReadiness: vi.fn().mockResolvedValue(noBlockersReadiness()),
    };

    const result = await loadViewerWdrrWeekly(session, { DATABASE_URL: "postgresql://localhost/test" }, dependencies);

    expect(result).toEqual([]);
  });

  it("excludes a review with an unresolved blocking finding", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          review_id: "rev_3",
          repository_id: "repo_1",
          created_at: "2026-08-03T00:00:00.000Z",
          base_run_id: "run_base",
          head_run_id: "run_head",
          evidence_digest: "a".repeat(64),
          head_run_status: "completed",
        },
      ],
    });

    const dependencies: WdrrDashboardDependencies = {
      evaluateReviewReadiness: vi.fn().mockResolvedValue({
        readiness: {
          ...noBlockersReadiness().readiness,
          blockers: [{ type: "unresolved_finding" as const, message: "x" }],
        },
      }),
    };

    const result = await loadViewerWdrrWeekly(session, { DATABASE_URL: "postgresql://localhost/test" }, dependencies);

    expect(result).toEqual([]);
  });

  it("excludes a review with no recorded base run, even when everything else is clean", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          review_id: "rev_4",
          repository_id: "repo_1",
          created_at: "2026-08-03T00:00:00.000Z",
          base_run_id: null,
          head_run_id: "run_head",
          evidence_digest: "a".repeat(64),
          head_run_status: "completed",
        },
      ],
    });

    const dependencies: WdrrDashboardDependencies = {
      evaluateReviewReadiness: vi.fn().mockResolvedValue(noBlockersReadiness()),
    };

    const result = await loadViewerWdrrWeekly(session, { DATABASE_URL: "postgresql://localhost/test" }, dependencies);

    expect(result).toEqual([]);
  });
});
