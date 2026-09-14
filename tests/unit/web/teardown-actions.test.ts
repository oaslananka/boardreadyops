import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teardown is the half of every create form that was missing.
 *
 * These cover the two things that make a destructive action safe rather than merely present:
 * the caller must be allowed to do it, and they must have named the thing they are destroying.
 * Both are enforced server-side, because the form is the part an attacker controls.
 */

const store = vi.hoisted(() => ({
  workspaceRoleFor: vi.fn(),
  workspaceIdForProject: vi.fn(),
  workspaceIdForDelivery: vi.fn(),
  listProjectsByWorkspace: vi.fn(),
  getWorkspaceById: vi.fn(),
  projectDeletionImpact: vi.fn(),
  workspaceDeletionImpact: vi.fn(),
  deleteProject: vi.fn(),
  deleteWorkspace: vi.fn(),
  renameProject: vi.fn(),
  renameWorkspace: vi.fn(),
  revokeDeliveryLink: vi.fn(),
}));

vi.mock("../../../apps/web/lib/workspace-store-access.js", () => ({
  openWorkspaceStore: vi.fn(async () => ({ store, executor: { close: vi.fn(async () => undefined) } })),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { login: "octocat", installationIds: [1] },
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  })),
}));

process.env.DATABASE_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

const { deleteProjectAction, deleteWorkspaceAction, renameProjectAction } = await import(
  "../../../apps/web/app/projects/actions.js"
);
const { revokeDeliveryLinkAction } = await import("../../../apps/web/app/deliveries/actions.js");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as never;

// Call counts leak between tests otherwise, and "was this never called?" is most of what these
// assert.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("project teardown", () => {
  it("refuses a delete from anyone who is not an owner", async () => {
    store.workspaceIdForProject.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("admin");

    const result = await deleteProjectAction(idle, form({ projectId: "prj-1", confirmName: "Gateway" }));

    expect(result).toMatchObject({ status: "error" });
    expect(store.deleteProject).not.toHaveBeenCalled();
  });

  it("gives the same answer for a project in another workspace as for one that does not exist", async () => {
    store.workspaceIdForProject.mockResolvedValue(null);
    const missing = await deleteProjectAction(idle, form({ projectId: "prj-x", confirmName: "Gateway" }));

    store.workspaceIdForProject.mockResolvedValue("ws-2");
    store.workspaceRoleFor.mockResolvedValue(null);
    const foreign = await deleteProjectAction(idle, form({ projectId: "prj-y", confirmName: "Gateway" }));

    // A guessed id must not reveal which ids are real.
    expect(missing).toEqual(foreign);
  });

  it("refuses when the typed name does not match, and says what to type", async () => {
    store.workspaceIdForProject.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("owner");
    store.listProjectsByWorkspace.mockResolvedValue([{ id: "prj-1", name: "Gateway board" }]);

    const result = await deleteProjectAction(idle, form({ projectId: "prj-1", confirmName: "gateway board" }));

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("Gateway board");
    expect(store.deleteProject).not.toHaveBeenCalled();
  });

  it("deletes on an exact match and reports what went with it", async () => {
    store.workspaceIdForProject.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("owner");
    store.listProjectsByWorkspace.mockResolvedValue([{ id: "prj-1", name: "Gateway board" }]);
    store.projectDeletionImpact.mockResolvedValue({ revisions: 3, deliveries: 1 });
    store.deleteProject.mockResolvedValue(true);

    const result = await deleteProjectAction(idle, form({ projectId: "prj-1", confirmName: "Gateway board" }));

    expect(result).toMatchObject({ status: "ok" });
    expect(JSON.stringify(result)).toContain("3 revision");
    expect(store.deleteProject).toHaveBeenCalledWith("prj-1");
  });

  it("lets a non-viewer rename but refuses a viewer", async () => {
    store.workspaceIdForProject.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("viewer");
    expect(await renameProjectAction(idle, form({ projectId: "prj-1", name: "New" }))).toMatchObject({
      status: "error",
    });

    store.workspaceRoleFor.mockResolvedValue("member");
    store.renameProject.mockResolvedValue(true);
    expect(await renameProjectAction(idle, form({ projectId: "prj-1", name: "New" }))).toMatchObject({ status: "ok" });
  });
});

describe("workspace teardown", () => {
  it("refuses a delete from an admin, because the cascade reaches everything", async () => {
    store.workspaceRoleFor.mockResolvedValue("admin");
    const result = await deleteWorkspaceAction(idle, form({ workspaceId: "ws-1", confirmName: "Acme" }));
    expect(result).toMatchObject({ status: "error" });
    expect(store.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("names every kind of thing the cascade removes", async () => {
    store.workspaceRoleFor.mockResolvedValue("owner");
    store.getWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Acme Hardware" });
    store.workspaceDeletionImpact.mockResolvedValue({ projects: 2, revisions: 9, deliveries: 4 });
    store.deleteWorkspace.mockResolvedValue(true);

    const result = await deleteWorkspaceAction(idle, form({ workspaceId: "ws-1", confirmName: "Acme Hardware" }));

    const message = JSON.stringify(result);
    expect(result).toMatchObject({ status: "ok" });
    expect(message).toContain("2 project");
    expect(message).toContain("9 revision");
    expect(message).toContain("4 delivery link");
  });
});

describe("delivery link revocation", () => {
  it("resolves the workspace from the delivery rather than trusting the form", async () => {
    store.workspaceIdForDelivery.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("member");
    store.revokeDeliveryLink.mockResolvedValue(true);

    const result = await revokeDeliveryLinkAction(idle, form({ deliveryId: "del-1" }));

    expect(store.workspaceIdForDelivery).toHaveBeenCalledWith("del-1");
    expect(store.workspaceRoleFor).toHaveBeenCalledWith("ws-1", "octocat");
    expect(result).toMatchObject({ status: "ok" });
  });

  it("refuses a viewer", async () => {
    store.workspaceIdForDelivery.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("viewer");
    expect(await revokeDeliveryLinkAction(idle, form({ deliveryId: "del-1" }))).toMatchObject({ status: "error" });
    expect(store.revokeDeliveryLink).not.toHaveBeenCalled();
  });

  it("says so when the link had already lapsed", async () => {
    store.workspaceIdForDelivery.mockResolvedValue("ws-1");
    store.workspaceRoleFor.mockResolvedValue("owner");
    store.revokeDeliveryLink.mockResolvedValue(false);

    const result = await revokeDeliveryLinkAction(idle, form({ deliveryId: "del-1" }));
    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("already expired");
  });
});
