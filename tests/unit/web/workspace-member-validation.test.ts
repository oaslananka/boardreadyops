import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adding a member grants access to a GitHub login typed into a box.
 *
 * A typo therefore grants access to an account that may not exist, or — the case nothing can
 * detect — to a different real person whose name is one character away. Refusing the first
 * catches most of it; these cover that the check runs after authorization, and that GitHub being
 * unreachable does not block member management.
 */

const store = vi.hoisted(() => ({
  workspaceRoleFor: vi.fn(),
  listWorkspaceMembers: vi.fn(async () => []),
  upsertWorkspaceMember: vi.fn(async () => ({ userId: "octocat", role: "member" })),
  removeWorkspaceMember: vi.fn(async () => true),
}));

vi.mock("../../../apps/web/lib/workspace-store-access.js", () => ({
  openWorkspaceStore: vi.fn(async () => ({ store, executor: { close: vi.fn(async () => undefined) } })),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { login: "owner-person", installationIds: [1] },
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  })),
}));

process.env.DATABASE_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

const { upsertWorkspaceMemberAction } = await import("../../../apps/web/app/settings/workspace/actions.js");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as never;
const add = () => form({ workspaceId: "ws-1", userId: "typoo", role: "member" });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("workspace member validation", () => {
  it("refuses a login GitHub does not know, and names it", async () => {
    store.workspaceRoleFor.mockResolvedValue("owner");
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    const result = await upsertWorkspaceMemberAction(idle, add());

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("typoo");
    expect(store.upsertWorkspaceMember).not.toHaveBeenCalled();
  });

  it("grants when GitHub knows the login", async () => {
    store.workspaceRoleFor.mockResolvedValue("owner");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ login: "typoo" }), { status: 200 }));

    const result = await upsertWorkspaceMemberAction(idle, add());

    expect(result).toMatchObject({ status: "ok" });
    expect(store.upsertWorkspaceMember).toHaveBeenCalled();
  });

  it("grants anyway when GitHub cannot answer, rather than blocking on an outage", async () => {
    store.workspaceRoleFor.mockResolvedValue("owner");
    for (const outage of [new Response("", { status: 403 }), new Response("", { status: 500 })]) {
      vi.clearAllMocks();
      store.workspaceRoleFor.mockResolvedValue("owner");
      fetchMock.mockResolvedValue(outage);
      expect(await upsertWorkspaceMemberAction(idle, add())).toMatchObject({ status: "ok" });
    }

    vi.clearAllMocks();
    store.workspaceRoleFor.mockResolvedValue("owner");
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
    expect(await upsertWorkspaceMemberAction(idle, add())).toMatchObject({ status: "ok" });
  });

  it("does not call GitHub at all for a caller who may not manage members", async () => {
    // Otherwise the form becomes a way for anyone to probe which logins exist.
    store.workspaceRoleFor.mockResolvedValue("viewer");

    const result = await upsertWorkspaceMemberAction(idle, add());

    expect(result).toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
