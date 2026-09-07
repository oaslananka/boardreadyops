import type { ApiTokenRecord } from "@boardreadyops/db";
import { describe, expect, it, vi } from "vitest";
import { resolveTokenAdminScope, tokenState } from "../../../apps/web/lib/api-token-admin.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const loadViewerRepositories = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/repository-dashboard.js", () => ({ loadViewerRepositories }));

const session = { login: "octocat", installationIds: [1] } as unknown as UserSession;

function repository(id: string) {
  return { id, accountLogin: "acme", owner: "acme", name: id, private: false };
}

function record(overrides: Partial<ApiTokenRecord> = {}): ApiTokenRecord {
  return {
    id: "tok_1",
    repositoryId: "repo_a",
    name: "ci",
    tokenPrefix: "brops_ab",
    scopes: ["runs:write"],
    createdBy: "octocat",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ApiTokenRecord;
}

describe("resolveTokenAdminScope", () => {
  it("defaults to the first repository the viewer can administer", async () => {
    loadViewerRepositories.mockResolvedValue([
      { accountLogin: "acme", repositories: [repository("repo_a"), repository("repo_b")] },
    ]);
    const scope = await resolveTokenAdminScope(session, undefined);
    expect(scope.selected?.id).toBe("repo_a");
    expect(scope.repositories).toHaveLength(2);
  });

  it("honours an explicit repository the viewer can reach", async () => {
    loadViewerRepositories.mockResolvedValue([
      { accountLogin: "acme", repositories: [repository("repo_a"), repository("repo_b")] },
    ]);
    await expect(resolveTokenAdminScope(session, "repo_b")).resolves.toMatchObject({ selected: { id: "repo_b" } });
  });

  it("refuses a repository outside the session's installations rather than falling back to another", async () => {
    // The requested id arrives from a query string, so it is never trusted on its own; silently
    // showing a different repository's tokens would be worse than showing none.
    loadViewerRepositories.mockResolvedValue([{ accountLogin: "acme", repositories: [repository("repo_a")] }]);
    const scope = await resolveTokenAdminScope(session, "repo_someone_else");
    expect(scope.selected).toBeUndefined();
  });

  it("reports no repositories for a signed-out viewer", async () => {
    loadViewerRepositories.mockResolvedValue([]);
    const scope = await resolveTokenAdminScope(undefined, undefined);
    expect(scope).toEqual({ repositories: [], selected: undefined });
  });
});

describe("tokenState", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("treats a revoked token as revoked even when its expiry is still in the future", () => {
    expect(
      tokenState(record({ revokedAt: "2026-02-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }), now),
    ).toBe("revoked");
  });

  it("treats a past expiry as expired", () => {
    expect(tokenState(record({ expiresAt: "2026-05-31T23:59:59.000Z" }), now)).toBe("expired");
  });

  it("treats a token with no expiry as active", () => {
    expect(tokenState(record(), now)).toBe("active");
  });
});
