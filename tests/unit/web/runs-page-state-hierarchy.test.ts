import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { login: "octocat", installationIds: [1] },
  })),
}));
const loadViewerRuns = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/run-listing.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadViewerRuns,
}));
const { default: RunsPage } = await import("../../../apps/web/app/runs/page.js");

describe("RunsPage status hierarchy", () => {
  it("keeps execution and readiness decisions separately visible", async () => {
    loadViewerRuns.mockResolvedValue({
      state: "ok",
      next: undefined,
      runs: [
        {
          id: "run_completed",
          repositoryId: "repo_a",
          repository: "acme/board",
          status: "completed",
          decision: "fail",
          commitSha: "abc123456",
          ref: "refs/heads/main",
          startedAt: "2026-10-01T10:00:00.000Z",
        },
        {
          id: "run_queued",
          repositoryId: "repo_a",
          repository: "acme/board",
          status: "queued",
          decision: undefined,
          commitSha: "def123456",
          ref: "refs/heads/main",
          startedAt: "2026-10-02T10:00:00.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(await RunsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Run state");
    expect(html).toContain("Execution: Completed");
    expect(html).toContain("Decision: Fail");
    expect(html).toContain("Execution: Queued");
    expect(html.match(/Decision:/gu)).toHaveLength(1);
  });
});
