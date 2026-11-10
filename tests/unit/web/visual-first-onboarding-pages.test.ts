import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, repositoriesMock, summaryMock, projectsMock, designEvidenceMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repositoriesMock: vi.fn(),
  summaryMock: vi.fn(),
  projectsMock: vi.fn(),
  designEvidenceMock: vi.fn(),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: authMock,
}));
vi.mock("../../../apps/web/lib/repository-dashboard.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../apps/web/lib/repository-dashboard.js")>();
  return {
    ...original,
    loadViewerRepositories: repositoriesMock,
    summarizeViewerRepositories: summaryMock,
    loadViewerDesignEvidence: designEvidenceMock,
  };
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
    designEvidenceMock.mockResolvedValue(undefined);
  });

  it("shows public attributed PCB/schematic ahead of the sign-in explanation on Dashboard", async () => {
    const page = await DashboardPage();
    const html = renderToStaticMarkup(page);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeGreaterThan(0);
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Sign in required"),
    );
    expect(html).toContain("royalblue54l-pcb.webp");
    expect(html).toContain("royalblue54l-schematic.webp");
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

  it("leads with the real GitHub review workflow and leaves CAD workspace and sample optional", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({ state: "no-workspaces" });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html.indexOf("Your next hardware review starts with the board")).toBeGreaterThan(0);
    expect(html.indexOf("Continue with GitHub repositories")).toBeLessThan(html.indexOf("Create your first workspace"));
    expect(html.indexOf("Continue with GitHub repositories")).toBeLessThan(
      html.indexOf('aria-label="Example PCB and schematic design views"'),
    );
    expect(html.indexOf('aria-label="Example PCB and schematic design views"')).toBeLessThan(
      html.indexOf('aria-label="Optional CAD workspace setup"'),
    );
    expect(html).toContain('aria-label="Optional CAD workspace setup"');
    expect(html).not.toContain('aria-label="Example hardware review"');
    expect(html).toContain("Open hardware reviews");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain("No CAD workspace is required");
    expect(html).toContain("separate memberships");
    expect(html).toContain("do not automatically import");
    expect(html).toContain("Create your first workspace");
    expect(html).toContain("Optional: group CAD projects");
    expect(repositoriesMock).not.toHaveBeenCalled();
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
      html.indexOf("No CAD workspace projects yet"),
    );
    expect(html).not.toContain('aria-label="Example hardware review"');
    expect(html).toContain('href="/reviews"');
    expect(html).not.toContain('href="/projects/new"');
  });

  it("shows the viewer's actual authorized run before CAD forms on an empty workspace", async () => {
    const session = { userId: "123", login: "tester", installationIds: [4321] };
    const groups = [
      {
        accountLogin: "tester",
        repositories: [{ id: "repo-z", owner: "tester", name: "pcb-source", latestRunId: "run-z" }],
      },
    ];
    authMock.mockResolvedValue({ session });
    repositoriesMock.mockResolvedValue(groups);
    designEvidenceMock.mockResolvedValue({
      runId: "run-z",
      repositoryId: "repo-z",
      repository: "tester/pcb-source",
      hasPcb: true,
      hasSchematic: true,
    });
    projectsMock.mockResolvedValue({
      state: "ok",
      selected: { id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" },
      workspaces: [{ id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" }],
      projects: [],
      impact: { workspace: { projects: 0, revisions: 0, deliveries: 0 }, byProject: {} },
      total: 0,
      page: 1,
      totalPages: 1,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Real recorded design evidence");
    expect(html).toContain("tester/pcb-source");
    expect(html).toContain("PCB layer published");
    expect(html).toContain("Schematic published");
    expect(html).toContain('href="/runs/run-z/design"');
    expect(html).toContain("not a sample or a signed manufacturing clearance");
    expect(html).toContain("Inspect recorded design");
    expect(html).toContain("without creating a CAD workspace project");
    expect(html).not.toContain('aria-label="Example PCB and schematic design views"');
    expect(html.indexOf("Real recorded design evidence")).toBeLessThan(html.indexOf("No CAD workspace projects yet"));
    expect(html.indexOf("Real recorded design evidence")).toBeLessThan(html.indexOf("Add a project</"));
    expect(repositoriesMock).toHaveBeenCalledWith(session);
    expect(designEvidenceMock).toHaveBeenCalledWith(session, groups);
  });

  it("keeps real source evidence first and optional CAD workspace separate when none exists", async () => {
    const session = { userId: "123", login: "tester", installationIds: [4321] };
    authMock.mockResolvedValue({ session });
    projectsMock.mockResolvedValue({ state: "no-workspaces" });
    designEvidenceMock.mockResolvedValue({
      runId: "run-z",
      repositoryId: "repo-z",
      repository: "tester/pcb-source",
      hasPcb: true,
      hasSchematic: true,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html.indexOf("Real recorded design evidence")).toBeLessThan(
      html.indexOf("Continue with GitHub repositories"),
    );
    expect(html).toContain('href="/runs/run-z/design"');
    expect(html).not.toContain('aria-label="Example PCB and schematic design views"');
    expect(html).toContain('aria-label="Optional CAD workspace setup"');
  });

  it("describes a PCB-only recorded run accurately without inventing a schematic", async () => {
    const session = { userId: "123", login: "tester", installationIds: [4321] };
    authMock.mockResolvedValue({ session });
    projectsMock.mockResolvedValue({ state: "no-workspaces" });
    designEvidenceMock.mockResolvedValue({
      runId: "run-z",
      repositoryId: "repo-z",
      repository: "tester/pcb-source",
      hasPcb: true,
      hasSchematic: false,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Explore your recorded PCB evidence");
    expect(html).not.toContain("Explore your actual PCB and schematic evidence");
    expect(html).toContain("PCB layer published");
    expect(html).not.toContain("Schematic published");
  });

  it("never queries private repository evidence without an authorized GitHub App installation", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester", installationIds: [] } });
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
    expect(html).not.toContain("Real recorded design evidence");
    expect(html).toContain("Example only");
    expect(repositoriesMock).not.toHaveBeenCalled();
    expect(designEvidenceMock).not.toHaveBeenCalled();
  });

  it("takes an owner directly to GitHub setup without an unnecessary project creation wizard", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({
      state: "ok",
      selected: { id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" },
      workspaces: [{ id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" }],
      projects: [],
      impact: { workspace: { projects: 0, revisions: 0, deliveries: 0 }, byProject: {} },
      total: 0,
      page: 1,
      totalPages: 1,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Review repository setup");
    expect(html).toContain('href="/setup"');
    expect(html).toContain("Example only");
  });

  it("shows a source-attributed example before the table when existing projects have no linked repository", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    projectsMock.mockResolvedValue({
      state: "ok",
      selected: { id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" },
      workspaces: [{ id: "workspace-1", name: "Hardware team", role: "owner", planTier: "free" }],
      projects: [
        {
          id: "project-1",
          name: "Unlinked board",
          description: null,
          defaultCadFormat: "kicad",
          createdAt: "2026-10-19T00:00:00Z",
          githubRepoFullName: null,
        },
      ],
      impact: { workspace: { projects: 1, revisions: 0, deliveries: 0 }, byProject: {} },
      total: 1,
      page: 1,
      totalPages: 1,
    });
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('aria-label="Example PCB and schematic design views"');
    expect(html).toContain("Example only");
    expect(html).toContain("not your repository");
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Unlinked board"),
    );
    expect(html).toContain('href="/setup"');
    expect(html).toContain("Connect your board repository");
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
    expect(designEvidenceMock).not.toHaveBeenCalled();
  });

  it("leads with an example when connected repositories have no runs yet", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    summaryMock.mockReturnValue({ ...emptySummary, repositories: 3, repositoriesWithoutRuns: 3 });
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain("Your next hardware review starts with the board");
    expect(html.indexOf("Your next hardware review starts with the board")).toBeLessThan(
      html.indexOf("Engineering status"),
    );
    expect(html).not.toContain('aria-label="Example hardware review"');
    expect(html).toContain('href="/demo/royalblue54l-pcb.webp"');
    expect(html).toContain('href="/demo/royalblue54l-schematic.webp"');
  });

  it("does not render an example above established repository data with existing runs", async () => {
    authMock.mockResolvedValue({ session: { userId: "123", login: "tester" } });
    summaryMock.mockReturnValue({ ...emptySummary, repositories: 3, repositoriesWithoutRuns: 1 });
    repositoriesMock.mockResolvedValue([]);
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).not.toContain("Your next hardware review starts with the board");
  });
});
