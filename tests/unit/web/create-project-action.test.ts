import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  workspaceRoleFor: vi.fn(),
  createProject: vi.fn(),
}));
const close = vi.hoisted(() => vi.fn(async () => undefined));
const loadViewerRepositoryResult = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/web/lib/workspace-store-access.js", () => ({
  openWorkspaceStore: vi.fn(async () => ({ store, executor: { close } })),
}));
vi.mock("../../../apps/web/lib/repository-dashboard.js", () => ({
  loadViewerRepositoryResult,
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { userId: 4711, login: "owner-person", installationIds: [1] },
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  })),
}));

process.env.DATABASE_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

const { createProjectAction } = await import("../../../apps/web/app/projects/actions.js");
const idle = { status: "idle" } as never;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function projectForm(repository = ""): FormData {
  return form({
    workspaceId: "ws-1",
    name: "BoardReadyOps hardware",
    description: "Manufacturing validation board",
    defaultCadFormat: "kicad",
    githubRepoFullName: repository,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.workspaceRoleFor.mockResolvedValue("owner");
  store.createProject.mockResolvedValue({
    id: "prj-1",
    workspaceId: "ws-1",
    name: "BoardReadyOps hardware",
    defaultCadFormat: "kicad",
    githubRepoFullName: "oaslananka/boardreadyops",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  loadViewerRepositoryResult.mockResolvedValue({
    state: "ok",
    groups: [
      {
        accountLogin: "oaslananka",
        repositories: [
          {
            id: "repo-1",
            installationId: "installation-1",
            githubInstallationId: 1001,
            accountLogin: "oaslananka",
            owner: "oaslananka",
            name: "boardreadyops",
            private: false,
            latestRunId: "run-1",
            latestRunStatus: "completed",
            latestRunDecision: "pass",
            latestRunAt: "2026-11-18T00:00:00.000Z",
            openFindings: 0,
            watchedBoards: 0,
            openSupplyFindings: 0,
          },
        ],
      },
    ],
  });
});

describe("createProjectAction repository association", () => {
  it("links a project only to a repository granted by the viewer's live GitHub installations", async () => {
    const result = await createProjectAction(idle, projectForm("OASLANANKA/BOARDREADYOPS"));

    expect(result).toMatchObject({ status: "ok", data: { projectId: "prj-1" } });
    expect(store.createProject).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "BoardReadyOps hardware",
      description: "Manufacturing validation board",
      defaultCadFormat: "kicad",
      githubRepoFullName: "oaslananka/boardreadyops",
    });
  });

  it("fails closed when the selected repository is not in the viewer's live installation grants", async () => {
    const result = await createProjectAction(idle, projectForm("someone-else/private-board"));

    expect(result).toMatchObject({ status: "error" });
    expect(store.createProject).not.toHaveBeenCalled();
  });

  it("fails closed when the current GitHub installation grants cannot be verified", async () => {
    loadViewerRepositoryResult.mockResolvedValue({ state: "access-unavailable", groups: [] });

    const result = await createProjectAction(idle, projectForm("oaslananka/boardreadyops"));

    expect(result).toMatchObject({ status: "error" });
    expect(store.createProject).not.toHaveBeenCalled();
  });

  it("keeps manually created CAD projects available without a GitHub repository", async () => {
    const result = await createProjectAction(idle, projectForm());

    expect(result).toMatchObject({ status: "ok" });
    expect(loadViewerRepositoryResult).not.toHaveBeenCalled();
    expect(store.createProject).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "BoardReadyOps hardware",
      description: "Manufacturing validation board",
      defaultCadFormat: "kicad",
    });
  });

  it("does not allow a workspace viewer to create or link a project", async () => {
    store.workspaceRoleFor.mockResolvedValue("viewer");

    const result = await createProjectAction(idle, projectForm("oaslananka/boardreadyops"));

    expect(result).toMatchObject({ status: "error" });
    expect(store.createProject).not.toHaveBeenCalled();
  });
});
