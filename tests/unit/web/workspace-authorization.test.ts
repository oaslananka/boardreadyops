import type { WorkspaceStore } from "@boardreadyops/db";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedApiContext } from "../../../apps/web/lib/api-auth.js";
import {
  authorizeWorkspace,
  canWriteWorkspace,
  workspaceUserIdFor,
} from "../../../apps/web/lib/workspace-authorization.js";

const sessionAuth: AuthenticatedApiContext = {
  ok: true,
  actorId: "alpha-admin",
  scopes: ["admin", "reviews:read", "reviews:write", "runs:write"],
  authType: "session",
  installationIds: [900001],
};

const tokenAuth: AuthenticatedApiContext = {
  ok: true,
  actorId: "tok_123",
  repositoryId: "repo_alpha",
  scopes: ["admin", "reviews:read", "reviews:write", "runs:write"],
  authType: "bearer_token",
};

function storeReturning(role: string | null) {
  return { workspaceRoleFor: vi.fn().mockResolvedValue(role) } as unknown as WorkspaceStore;
}

describe("workspaceUserIdFor", () => {
  it("uses the login of a signed-in session as the membership key", () => {
    expect(workspaceUserIdFor(sessionAuth)).toBe("alpha-admin");
  });

  it("gives a repository-scoped API token no workspace identity", () => {
    // The token's actorId is the token's own id, not a user. Accepting it would mean matching
    // membership rows against something that is never in them, or skipping the check entirely.
    expect(workspaceUserIdFor(tokenAuth)).toBeUndefined();
  });
});

describe("authorizeWorkspace", () => {
  it("admits a member and reports their role", async () => {
    const store = storeReturning("admin");
    await expect(authorizeWorkspace(sessionAuth, store, "ws_alpha")).resolves.toEqual({
      ok: true,
      userId: "alpha-admin",
      role: "admin",
    });
  });

  it("answers 404, not 403, for a workspace the caller is not in", async () => {
    // 403 would confirm the id exists. A workspace id or slug is guessable, and the workspace's
    // name, plan tier and Stripe customer id all hang off that answer.
    await expect(authorizeWorkspace(sessionAuth, storeReturning(null), "ws_beta")).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Workspace not found",
    });
  });

  it("answers 404 when the resource the request named does not resolve to a workspace", async () => {
    const store = storeReturning("owner");
    await expect(authorizeWorkspace(sessionAuth, store, null)).resolves.toMatchObject({ ok: false, status: 404 });
    expect(store.workspaceRoleFor).not.toHaveBeenCalled();
  });

  it("turns an API token away before it reaches the database", async () => {
    const store = storeReturning("owner");
    const result = await authorizeWorkspace(tokenAuth, store, "ws_alpha");
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(store.workspaceRoleFor).not.toHaveBeenCalled();
  });
});

describe("canWriteWorkspace", () => {
  it("lets owners, admins and members write", () => {
    expect(canWriteWorkspace("owner")).toBe(true);
    expect(canWriteWorkspace("admin")).toBe(true);
    expect(canWriteWorkspace("member")).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(canWriteWorkspace("viewer")).toBe(false);
  });
});
