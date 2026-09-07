import { describe, expect, it, vi } from "vitest";
import { loadViewerWorkspaces, loadWorkspaceProjects } from "../../../apps/web/lib/project-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const listWorkspacesForUser = vi.fn();
const listProjectsByWorkspace = vi.fn();
const close = vi.fn();

vi.mock("../../../packages/db/src/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // A class, not `vi.fn(() => ({...}))`: the module under test calls `new WorkspaceStore(...)`,
  // and an arrow function is not a constructor.
  WorkspaceStore: class {
    listWorkspacesForUser = listWorkspacesForUser;
    listProjectsByWorkspace = listProjectsByWorkspace;
  },
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query: vi.fn(), close })),
}));

const session: UserSession = {
  userId: 1,
  login: "octocat",
  installationIds: [],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const postgres = { DATABASE_URL: "postgresql://user@localhost:5432/db" } as NodeJS.ProcessEnv;

function workspace(id: string, name = id) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    planTier: "community" as const,
    createdAt: "2026-09-01T00:00:00.000Z",
    role: "owner" as const,
  };
}

describe("loadWorkspaceProjects", () => {
  it("lists the projects of the requested workspace", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a", "Alpha"), workspace("ws_b", "Beta")]);
    listProjectsByWorkspace.mockReset().mockResolvedValue([{ id: "prj_1", name: "Gateway" }]);

    const result = await loadWorkspaceProjects(session, "ws_b", postgres);

    expect(result.state).toBe("ok");
    expect(result.state === "ok" && result.selected.id).toBe("ws_b");
    expect(listProjectsByWorkspace).toHaveBeenCalledWith("ws_b");
  });

  it("scopes the workspace list to the viewer's login, which is the membership key", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);
    listProjectsByWorkspace.mockReset().mockResolvedValue([]);

    await loadWorkspaceProjects(session, undefined, postgres);

    expect(listWorkspacesForUser).toHaveBeenCalledWith("octocat");
  });

  it("falls back to a workspace the viewer is in when the requested id is not theirs", async () => {
    // A stale bookmark, or a workspace they were removed from. Showing one they *can* see beats
    // an error page, and the fallback is chosen from their own memberships so it leaks nothing.
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a", "Alpha")]);
    listProjectsByWorkspace.mockReset().mockResolvedValue([]);

    const result = await loadWorkspaceProjects(session, "ws_someone_elses", postgres);

    expect(result.state === "ok" && result.selected.id).toBe("ws_a");
    // Crucially it never asked the store for the requested workspace's projects.
    expect(listProjectsByWorkspace).toHaveBeenCalledWith("ws_a");
    expect(listProjectsByWorkspace).not.toHaveBeenCalledWith("ws_someone_elses");
  });

  it("reports no-workspaces rather than an empty list, so the page can offer to create one", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([]);
    listProjectsByWorkspace.mockReset();

    const result = await loadWorkspaceProjects(session, undefined, postgres);

    expect(result).toEqual({ state: "no-workspaces" });
    expect(listProjectsByWorkspace).not.toHaveBeenCalled();
  });

  it("reports signed-out and not-configured without touching the store", async () => {
    listWorkspacesForUser.mockReset();

    await expect(loadWorkspaceProjects(undefined, undefined, postgres)).resolves.toEqual({ state: "signed-out" });
    await expect(loadWorkspaceProjects(session, undefined, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      state: "not-configured",
    });
    expect(listWorkspacesForUser).not.toHaveBeenCalled();
  });

  it("closes the connection even when the store throws", async () => {
    close.mockReset();
    listWorkspacesForUser.mockReset().mockRejectedValue(new Error("connection reset"));

    await expect(loadWorkspaceProjects(session, undefined, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("loadViewerWorkspaces", () => {
  it("returns the viewer's memberships", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);

    await expect(loadViewerWorkspaces(session, postgres)).resolves.toHaveLength(1);
  });

  it("returns nothing without a session or a database, rather than throwing", async () => {
    listWorkspacesForUser.mockReset();

    await expect(loadViewerWorkspaces(undefined, postgres)).resolves.toEqual([]);
    await expect(loadViewerWorkspaces(session, {} as NodeJS.ProcessEnv)).resolves.toEqual([]);
    expect(listWorkspacesForUser).not.toHaveBeenCalled();
  });
});
