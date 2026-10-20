import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, repositoriesMock, summaryMock, projectsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repositoriesMock: vi.fn(),
  summaryMock: vi.fn(),
  projectsMock: vi.fn(),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: authMock,
}));
vi.mock("../../../apps/web/lib/repository-dashboard.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../apps/web/lib/repository-dashboard.js")>();
  return { ...original, loadViewerRepositories: repositoriesMock, summarizeViewerRepositories: summaryMock };
});
vi.mock("../../../apps/web/lib/project-listing.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../apps/web/lib/project-listing.js")>();
  return { ...original, loadWorkspaceProjects: projectsMock };
});

import DashboardPage from "../../../apps/web/app/dashboard/page.js";
import ProjectsPage from "../../../apps/web/app/projects/page.js";

const emptySummary = {
  repositories: 0,
  repositoriesWithOpenFindings: 0,
  supplyAlerts: 0,
  repositoriesWithoutRuns: 0,
  watchedBoards: 0,
};

describe("first-use visual-first routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ session: undefined });
    repositoriesMock.mockResolvedValue([]);
    summaryMock.mockReturnValue(emptySummary);
    projectsMock.mockResolvedValue({ state: "signed-out" });
  });

  it("shows public attributed PCB/schematic ahead of the sign-in explanation on Dashboard", async () => {
    const page = await DashboardPage();
    const html = renderToStaticMarkup(page);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeGreaterThan(0);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Sign in required"),
    );
    expect(html).toContain("zaptrace-sample-pcb.png");
    expect(html).toContain("zaptrace-sample-schematic.png");
    expect(html).toContain('href="/api/auth/github/login"');
  });

  it("shows a public example before gated workspace/project forms without listing private projects", async () => {
    const page = await ProjectsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Sign in to see your projects"),
    );
    expect(html).toContain("not your repository");
    expect(html).toContain('href="/api/auth/github/login"');
    expect(projectsMock).toHaveBeenCalledOnce();
  });

  it("leads with the KiCad example instead of the create-workspace form for a first-time member", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({ state: "no-workspaces" });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html.indexOf("Your next hardware review starts with the board")).toBeGreaterThan(0);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Create your first workspace"),
    );
    expect(html).toContain('href="/setup"');
  });

  it("places an example before a genuinely empty authorized workspace", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({
      state: "ok",
      selected: { id: "workspace-1", name: "Hardware team", role: "viewer", planTier: "free" },
      workspaces: [{ id: "workspace-1", name: "Hardware team", role: "viewer", planTier: "free" }],
      projects: [],
      impact: { workspace: { projects: 0, revisions: 0, deliveries: 0 }, byProject: {} },
      total: 0,
      page: 1,
      totalPages: 1,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html.indexOf("Your next hardware review starts with the board")).toBeGreaterThan(0);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("No projects in this workspace yet"),
    );
    expect(html).toContain('href="/projects/new"');
  });

  it("does not mistake a non-owner's zero impact counts for an empty project workspace", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({
      state: "ok",
      selected: { id: "workspace-1", name: "Hardware team", role: "viewer", planTier: "free" },
      workspaces: [{ id: "workspace-1", name: "Hardware team", role: "viewer", planTier: "free" }],
      projects: [
        {
          id: "project-1",
          name: "Real board",
          description: null,
          defaultCadFormat: "kicad",
          createdAt: "2026-10-19T00:00:00Z",
          githubRepoFullName: "user/repo",
        },
      ],
      impact: { workspace: { projects: 0, revisions: 0, deliveries: 0 }, byProject: {} },
      total: 1,
      page: 1,
      totalPages: 1,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Your next hardware review starts with the board");
    expect(html).toContain("Real board");
  });

  it("leads with an example when connected repositories have no runs yet", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    summaryMock.mockReturnValue({ ...emptySummary, repositories: 3, repositoriesWithoutRuns: 3 });
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain("Your next hardware review starts with the board");
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Engineering status"),
    );
  });

  it("does not render an example above established repository data with existing runs", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    summaryMock.mockReturnValue({ ...emptySummary, repositories: 3, repositoriesWithoutRuns: 1 });
    repositoriesMock.mockResolvedValue([]);
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).not.toContain("Your next hardware review starts with the board");
  });
});
