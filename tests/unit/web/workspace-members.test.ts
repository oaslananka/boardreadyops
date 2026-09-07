import { describe, expect, it, vi } from "vitest";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import { canManageMembers, isLastOwner, loadWorkspaceMembers } from "../../../apps/web/lib/workspace-members.js";

const listWorkspacesForUser = vi.fn();
const listWorkspaceMembers = vi.fn();
const close = vi.fn();

vi.mock("../../../packages/db/src/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WorkspaceStore: class {
    listWorkspacesForUser = listWorkspacesForUser;
    listWorkspaceMembers = listWorkspaceMembers;
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

const workspace = (id: string, role: "owner" | "admin" | "member" | "viewer" = "owner") => ({
  id,
  name: id,
  slug: id,
  planTier: "community" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  role,
});

const member = (userId: string, role: "owner" | "admin" | "member" | "viewer") => ({
  workspaceId: "ws_a",
  userId,
  role,
  createdAt: "2026-09-01T00:00:00.000Z",
});

describe("canManageMembers", () => {
  it("admits owners and admins only", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
  });
});

describe("isLastOwner", () => {
  it("recognises the only owner", () => {
    const members = [member("alice", "owner"), member("bob", "admin"), member("carol", "member")];
    expect(isLastOwner(members, "alice")).toBe(true);
    expect(isLastOwner(members, "bob")).toBe(false);
  });

  it("does not call an owner the last one when another exists", () => {
    // Two owners means either can go, which is the whole reason to promote a second.
    const members = [member("alice", "owner"), member("bob", "owner")];
    expect(isLastOwner(members, "alice")).toBe(false);
    expect(isLastOwner(members, "bob")).toBe(false);
  });

  it("says no for someone who is not a member", () => {
    expect(isLastOwner([member("alice", "owner")], "stranger")).toBe(false);
  });
});

describe("loadWorkspaceMembers", () => {
  it("lists members of the requested workspace", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a"), workspace("ws_b")]);
    listWorkspaceMembers.mockReset().mockResolvedValue([member("octocat", "owner")]);

    const result = await loadWorkspaceMembers(session, "ws_b", postgres);

    expect(result.state === "ok" && result.selected.id).toBe("ws_b");
    expect(listWorkspaceMembers).toHaveBeenCalledWith("ws_b");
  });

  it("keys the workspace list on the viewer's login", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);
    listWorkspaceMembers.mockReset().mockResolvedValue([]);

    await loadWorkspaceMembers(session, undefined, postgres);
    expect(listWorkspacesForUser).toHaveBeenCalledWith("octocat");
  });

  it("never reads the members of a workspace the viewer is not in", async () => {
    // Membership is the thing this page manages, so leaking who is in someone else's workspace
    // would be the worst version of getting the scoping wrong.
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);
    listWorkspaceMembers.mockReset().mockResolvedValue([]);

    const result = await loadWorkspaceMembers(session, "ws_someone_elses", postgres);

    expect(result.state === "ok" && result.selected.id).toBe("ws_a");
    expect(listWorkspaceMembers).not.toHaveBeenCalledWith("ws_someone_elses");
  });

  it("reports no-workspaces, signed-out and not-configured distinctly", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([]);
    listWorkspaceMembers.mockReset();

    await expect(loadWorkspaceMembers(session, undefined, postgres)).resolves.toEqual({ state: "no-workspaces" });
    await expect(loadWorkspaceMembers(undefined, undefined, postgres)).resolves.toEqual({ state: "signed-out" });
    await expect(loadWorkspaceMembers(session, undefined, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      state: "not-configured",
    });
    expect(listWorkspaceMembers).not.toHaveBeenCalled();
  });

  it("closes the connection even when the listing throws", async () => {
    close.mockReset();
    listWorkspacesForUser.mockReset().mockRejectedValue(new Error("connection reset"));

    await expect(loadWorkspaceMembers(session, undefined, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
