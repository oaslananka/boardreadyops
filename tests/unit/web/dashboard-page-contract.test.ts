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

describe("dashboard operational hierarchy", () => {
  it("derives a compact summary from the loaded repository groups", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Engineering status");
    expect(markup).toContain("Repositories with findings");
    expect(markup).toContain("Supply alerts");
    expect(markup).toContain("No run yet");
    expect(markup).toContain("Boards watched");
    expect(markup).not.toContain("this week");
    expect(markup).not.toContain("trend");
  });

  it("renders repository account groups as sections with a wide, scrollable table", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("octocat/widgets");
    expect(markup).toContain("overflow-x-auto");
  });

  it("renders an attention banner with a next-action hint when findings are open", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Attention required");
    expect(markup).toContain("Next action");
  });
});
