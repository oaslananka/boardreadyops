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
  it("distinguishes missing control-plane configuration from a genuinely empty run history", async () => {
    loadViewerRuns.mockResolvedValue({ state: "not-configured" });
    const unavailable = renderToStaticMarkup(await RunsPage({ searchParams: Promise.resolve({}) }));
    expect(unavailable).toContain("Run history is not configured");
    expect(unavailable).toContain("no control-plane database");
    expect(unavailable).not.toContain("No runs recorded yet");
    expect(unavailable).not.toContain("Open a pull request so the readiness workflow runs");

    const cursor = Buffer.from(JSON.stringify({ startedAt: "2026-11-01T10:00:00.000Z", id: "run-1" })).toString(
      "base64url",
    );
    const back = Buffer.from(JSON.stringify([""])).toString("base64url");
    const unavailableWithPagination = renderToStaticMarkup(
      await RunsPage({ searchParams: Promise.resolve({ cursor, back }) }),
    );
    expect(unavailableWithPagination).not.toContain('aria-label="Run pagination"');

    loadViewerRuns.mockResolvedValue({ state: "ok", next: undefined, runs: [] });
    const empty = renderToStaticMarkup(await RunsPage({ searchParams: Promise.resolve({}) }));
    expect(empty).toContain("No runs recorded yet");
    expect(empty).not.toContain("Run history is not configured");
  });
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
