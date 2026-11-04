import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { login: "octocat", installationIds: [1] },
  })),
}));
vi.mock("../../../apps/web/components/run-live-refresh.js", () => ({
  RunLiveRefresh: () => "Live status updates refresh every five seconds and resume automatically after reconnect.",
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
  it.each(["queued", "dispatching", "dispatched", "running", "reporting", "reconciliation_required"])(
    "refreshes the run list while a %s run can still progress",
    async (status) => {
      loadViewerRuns.mockResolvedValue({
        state: "ok",
        next: undefined,
        runs: [
          {
            id: "run-live",
            repositoryId: "repo-a",
            repository: "acme/board",
            status,
            decision: undefined,
            commitSha: "1".repeat(40),
            ref: "refs/heads/main",
            startedAt: "2026-11-04T08:00:00.000Z",
          },
        ],
      });
      const markup = renderToStaticMarkup(await RunsPage({ searchParams: Promise.resolve({}) }));
      expect(markup).toContain("Live status updates");
      expect(markup).toContain("refresh every five seconds");
    },
  );

  it.each(["completed", "failed", "timed_out", "cancelled", "superseded"])(
    "does not poll a run list with only %s history",
    async (status) => {
      loadViewerRuns.mockResolvedValue({
        state: "ok",
        next: undefined,
        runs: [
          {
            id: "run-terminal",
            repositoryId: "repo-a",
            repository: "acme/board",
            status,
            decision: undefined,
            commitSha: "2".repeat(40),
            ref: "refs/heads/main",
            startedAt: "2026-11-04T08:00:00.000Z",
          },
        ],
      });
      const markup = renderToStaticMarkup(await RunsPage({ searchParams: Promise.resolve({}) }));
      expect(markup).not.toContain("Live status updates");
    },
  );

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
