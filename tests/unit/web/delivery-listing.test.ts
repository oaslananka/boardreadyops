import { describe, expect, it, vi } from "vitest";
import { deliveryExpired, loadWorkspaceDeliveries } from "../../../apps/web/lib/delivery-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const listWorkspacesForUser = vi.fn();
const listDeliveriesByWorkspace = vi.fn();
const listRevisionsByWorkspace = vi.fn();
const close = vi.fn();

vi.mock("../../../packages/db/src/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WorkspaceStore: class {
    listWorkspacesForUser = listWorkspacesForUser;
    listDeliveriesByWorkspace = listDeliveriesByWorkspace;
    listRevisionsByWorkspace = listRevisionsByWorkspace;
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

describe("deliveryExpired", () => {
  it("reads a window that has closed as expired", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    expect(deliveryExpired({ expiresAt: "2026-09-06T12:00:00.000Z" }, now)).toBe(true);
    expect(deliveryExpired({ expiresAt: "2026-09-08T12:00:00.000Z" }, now)).toBe(false);
  });

  it("treats the exact expiry instant as closed, matching the guest page", () => {
    // `/deliveries/[token]` refuses on `expiresAt <= now`, and a list that disagreed with the
    // page would show "Live" for a link that already 410s.
    const now = new Date("2026-09-07T12:00:00.000Z");
    expect(deliveryExpired({ expiresAt: "2026-09-07T12:00:00.000Z" }, now)).toBe(true);
  });

  it("does not call an unparseable date expired, which would hide a real link", () => {
    expect(deliveryExpired({ expiresAt: "not a date" }, new Date())).toBe(false);
  });
});

describe("loadWorkspaceDeliveries", () => {
  it("lists deliveries and shareable revisions for the selected workspace", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a", "Alpha"), workspace("ws_b", "Beta")]);
    listDeliveriesByWorkspace.mockReset().mockResolvedValue([{ id: "del_1" }]);
    listRevisionsByWorkspace.mockReset().mockResolvedValue([{ id: "rev_1" }]);

    const result = await loadWorkspaceDeliveries(session, "ws_b", postgres);

    expect(result.state).toBe("ok");
    expect(result.state === "ok" && result.selected.id).toBe("ws_b");
    expect(listDeliveriesByWorkspace).toHaveBeenCalledWith("ws_b");
    expect(listRevisionsByWorkspace).toHaveBeenCalledWith("ws_b");
  });

  it("keys the workspace list on the viewer's login", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);
    listDeliveriesByWorkspace.mockReset().mockResolvedValue([]);
    listRevisionsByWorkspace.mockReset().mockResolvedValue([]);

    await loadWorkspaceDeliveries(session, undefined, postgres);

    expect(listWorkspacesForUser).toHaveBeenCalledWith("octocat");
  });

  it("never reads a workspace the viewer is not a member of", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a", "Alpha")]);
    listDeliveriesByWorkspace.mockReset().mockResolvedValue([]);
    listRevisionsByWorkspace.mockReset().mockResolvedValue([]);

    const result = await loadWorkspaceDeliveries(session, "ws_someone_elses", postgres);

    expect(result.state === "ok" && result.selected.id).toBe("ws_a");
    expect(listDeliveriesByWorkspace).not.toHaveBeenCalledWith("ws_someone_elses");
    expect(listRevisionsByWorkspace).not.toHaveBeenCalledWith("ws_someone_elses");
  });

  it("reports no-workspaces without listing anything", async () => {
    listWorkspacesForUser.mockReset().mockResolvedValue([]);
    listDeliveriesByWorkspace.mockReset();
    listRevisionsByWorkspace.mockReset();

    await expect(loadWorkspaceDeliveries(session, undefined, postgres)).resolves.toEqual({
      state: "no-workspaces",
    });
    expect(listDeliveriesByWorkspace).not.toHaveBeenCalled();
  });

  it("reports signed-out and not-configured without touching the store", async () => {
    listWorkspacesForUser.mockReset();

    await expect(loadWorkspaceDeliveries(undefined, undefined, postgres)).resolves.toEqual({ state: "signed-out" });
    await expect(loadWorkspaceDeliveries(session, undefined, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      state: "not-configured",
    });
    expect(listWorkspacesForUser).not.toHaveBeenCalled();
  });

  it("closes the connection even when a listing throws", async () => {
    close.mockReset();
    listWorkspacesForUser.mockReset().mockResolvedValue([workspace("ws_a")]);
    listDeliveriesByWorkspace.mockReset().mockRejectedValue(new Error("connection reset"));
    listRevisionsByWorkspace.mockReset().mockResolvedValue([]);

    await expect(loadWorkspaceDeliveries(session, undefined, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
