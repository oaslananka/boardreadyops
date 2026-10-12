import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "octocat" } })),
}));
vi.mock("../../../apps/web/lib/repository-dashboard.js", () => ({
  loadViewerRepositories: vi.fn(async () => [
    {
      accountLogin: "octocat",
      repositories: [
        {
          id: "repo-1",
          owner: "octocat",
          name: "widgets",
          private: false,
          latestRunId: "run-1",
          latestRunDecision: "pass",
          latestRunStatus: "completed",
          latestRunAt: "2026-09-05T00:00:00.000Z",
          openFindings: 2,
          watchedBoards: 3,
          openSupplyFindings: 0,
        },
      ],
    },
  ]),
  summarizeViewerRepositories: vi.fn(() => ({
    repositories: 1,
    repositoriesWithOpenFindings: 1,
    supplyAlerts: 0,
    repositoriesWithoutRuns: 0,
    watchedBoards: 3,
  })),
}));

const { default: DashboardPage } = await import("../../../apps/web/app/dashboard/page.js");
const { loadViewerRepositories, summarizeViewerRepositories } = await import(
  "../../../apps/web/lib/repository-dashboard.js"
);

describe("dashboard operational hierarchy", () => {
  it("derives a compact summary from the loaded repository groups", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Engineering status");
    expect(markup).toContain("Repositories with findings");
    expect(markup).toContain("Supply alerts");
    expect(markup).toContain("No run yet");
    expect(markup).toContain("Supply-tracked boards");
    expect(markup).toContain("A zero does not mean your connected repositories have stopped being checked.");
    expect(markup).not.toContain("this week");
    expect(markup).not.toContain("trend");
  });

  it("renders repository account groups as sections with a wide, scrollable table", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("octocat/widgets");
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain('href="/runs/run-1"');
    expect(markup).toContain('aria-label="Open latest run for octocat/widgets"');
  });

  it("routes supply-only attention to Parts without inventing a findings run", async () => {
    vi.mocked(loadViewerRepositories).mockResolvedValueOnce([
      {
        accountLogin: "octocat",
        repositories: [
          {
            id: "repo-2",
            installationId: "installation-2",
            githubInstallationId: 123,
            accountLogin: "octocat",
            owner: "octocat",
            name: "power",
            private: true,
            latestRunId: "run-2",
            latestRunStatus: "completed",
            latestRunDecision: "pass",
            latestRunAt: "2026-09-05T00:00:00.000Z",
            openFindings: 0,
            watchedBoards: 1,
            openSupplyFindings: 2,
          },
        ],
      },
    ]);
    vi.mocked(summarizeViewerRepositories).mockReturnValueOnce({
      repositories: 1,
      repositoriesWithOpenFindings: 0,
      supplyAlerts: 2,
      repositoriesWithoutRuns: 0,
      watchedBoards: 1,
    });
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain('href="/parts"');
    expect(markup).toContain("Review supply alerts");
    expect(markup).not.toContain('href="/runs/run-2/findings"');
  });

  it("renders an attention banner with a next-action hint when findings are open", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Attention required");
    expect(markup).toContain("Next action");
    expect(markup).toContain('href="/runs/run-1/findings"');
    expect(markup).toContain("Review 2 findings in octocat/widgets");
  });
});
