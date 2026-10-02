import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  workspaceRoleFor: vi.fn(),
  listWorkspaceMembers: vi.fn(async () => []),
  upsertWorkspaceMember: vi.fn(async (input: { subject: { githubUserId: number; login: string }; role: string }) => ({
    userId: input.subject.login,
    githubUserId: input.subject.githubUserId,
    githubLogin: input.subject.login,
    role: input.role,
  })),
  removeWorkspaceMember: vi.fn(async () => true),
}));

vi.mock("../../../apps/web/lib/workspace-store-access.js", () => ({
  openWorkspaceStore: vi.fn(async () => ({ store, executor: { close: vi.fn(async () => undefined) } })),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { userId: 4711, login: "owner-person", installationIds: [1] },
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  })),
}));

process.env.DATABASE_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

const { resolveWorkspaceMemberIdentityAction, upsertWorkspaceMemberAction } = await import(
  "../../../apps/web/app/settings/workspace/actions.js"
);

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as never;
const lookup = () => form({ workspaceId: "ws-1", userId: "octocat" });
const grant = (githubUserId = "583231") =>
  form({ workspaceId: "ws-1", userId: "octocat", githubUserId, role: "member" });

function githubUser(id = 583231) {
  return new Response(
    JSON.stringify({
      id,
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
      type: "User",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  store.workspaceRoleFor.mockResolvedValue("owner");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("workspace member identity verification", () => {
  it("resolves identity metadata without granting access", async () => {
    fetchMock.mockResolvedValue(githubUser());

    const result = await resolveWorkspaceMemberIdentityAction(idle, lookup());

    expect(result).toMatchObject({
      status: "ok",
      data: {
        githubUserId: 583231,
        login: "octocat",
        displayName: "The Octocat",
      },
    });
    expect(store.upsertWorkspaceMember).not.toHaveBeenCalled();
  });

  it("refuses a login GitHub does not know", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    const result = await resolveWorkspaceMemberIdentityAction(idle, lookup());

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("octocat");
    expect(store.upsertWorkspaceMember).not.toHaveBeenCalled();
  });

  it("fails closed when GitHub cannot verify the principal", async () => {
    for (const failure of [
      () => Promise.resolve(new Response("", { status: 403 })),
      () => Promise.resolve(new Response("", { status: 500 })),
      () => Promise.reject(new Error("ETIMEDOUT")),
    ]) {
      vi.clearAllMocks();
      store.workspaceRoleFor.mockResolvedValue("owner");
      fetchMock.mockImplementation(failure);

      expect(await upsertWorkspaceMemberAction(idle, grant())).toMatchObject({ status: "error" });
      expect(store.upsertWorkspaceMember).not.toHaveBeenCalled();
    }
  });

  it("requires the confirmed stable GitHub user id to match the write-time lookup", async () => {
    fetchMock.mockResolvedValue(githubUser(999999));

    const result = await upsertWorkspaceMemberAction(idle, grant("583231"));

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("identity changed");
    expect(store.upsertWorkspaceMember).not.toHaveBeenCalled();
  });

  it("grants the re-verified stable principal and records the actor identity in the store call", async () => {
    fetchMock.mockResolvedValue(githubUser());

    const result = await upsertWorkspaceMemberAction(idle, grant());

    expect(result).toMatchObject({ status: "ok" });
    expect(store.upsertWorkspaceMember).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      subject: expect.objectContaining({ githubUserId: 583231, login: "octocat" }),
      actor: { githubUserId: 4711, login: "owner-person" },
      role: "member",
    });
  });

  it("does not call GitHub for a caller who may not manage members", async () => {
    store.workspaceRoleFor.mockResolvedValue("viewer");

    const result = await resolveWorkspaceMemberIdentityAction(idle, lookup());

    expect(result).toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
