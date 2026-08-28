import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

import { type AuthenticatedApiContext, resolveRepositoryApiContext } from "../../../apps/web/lib/api-auth.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPersistenceMode = process.env.BOARDREADYOPS_PERSISTENCE_MODE;

afterEach(() => {
  query.mockReset();
  close.mockClear();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPersistenceMode === undefined) delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
  else process.env.BOARDREADYOPS_PERSISTENCE_MODE = originalPersistenceMode;
});

function sessionAuth(installationIds: number[]): AuthenticatedApiContext {
  return {
    ok: true,
    actorId: "octo-dev",
    scopes: ["admin"],
    authType: "session",
    installationIds,
  };
}

describe("repository API authorization", () => {
  it("authorizes session repository access only through one of the viewer's active installations", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: "1001" }] });

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001, 1002]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-1"),
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("repositories.installation_id");
    expect(sql).toContain("github_marketplace_subscriptions");
    expect(sql).toContain("status = 'canceled'");
    expect(sql).toContain(
      "github_marketplace_subscriptions.github_installation_id = installations.github_installation_id",
    );
    expect(sql).toContain("github_marketplace_subscriptions.github_installation_id is null");
    expect(sql).toContain("lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)");
    expect(close).not.toHaveBeenCalled();

    if (!(result instanceof Response)) await result.executor.close();
  });

  it("denies a session that supplies a repository outside its installation scope", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: "9999" }] });

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-other"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
