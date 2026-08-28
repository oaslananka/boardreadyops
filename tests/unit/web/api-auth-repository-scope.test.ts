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

function configurePostgres() {
  process.env.DATABASE_URL = "postgresql://localhost/test";
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
}

function sessionAuth(installationIds: number[]): AuthenticatedApiContext {
  return {
    ok: true,
    actorId: "octo-dev",
    scopes: ["admin"],
    authType: "session",
    installationIds,
  };
}

function bearerAuth(repositoryId = "repo-token"): AuthenticatedApiContext {
  return {
    ok: true,
    repositoryId,
    actorId: "token-1",
    scopes: ["admin"],
    authType: "bearer_token",
  };
}

describe("repository API authorization", () => {
  it("authorizes session repository access only through one of the viewer's active installations", async () => {
    configurePostgres();
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

  it("accepts node-postgres bigint values that are already decoded as safe numbers", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: 1001 }] });

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-1"),
    );

    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) await result.executor.close();
  });

  it("denies a session that supplies a repository outside its installation scope", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: "9999" }] });

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-other"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("denies an explicit repository that conflicts with a bearer token scope before opening a database executor", async () => {
    configurePostgres();

    const result = await resolveRepositoryApiContext(
      bearerAuth(),
      new Request("https://boardreadyops.test/api/v1/reviews"),
      "repo-other",
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("denies a query repository that conflicts with a bearer token scope", async () => {
    configurePostgres();

    const result = await resolveRepositoryApiContext(
      bearerAuth(),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-other"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects requests without a repository scope", async () => {
    configurePostgres();

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects repository access when durable PostgreSQL persistence is disabled", async () => {
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    delete process.env.DATABASE_URL;

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-1"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed when the repository installation id cannot be represented safely", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: "not-a-number" }] });

    const result = await resolveRepositoryApiContext(
      sessionAuth([1001]),
      new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-1"),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("allows a bearer token only for its active repository without requiring session installation ids", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [{ github_installation_id: "1001" }] });

    const result = await resolveRepositoryApiContext(
      bearerAuth("repo-token"),
      new Request("https://boardreadyops.test/api/v1/reviews"),
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["repo-token"]);
    if (!(result instanceof Response)) await result.executor.close();
  });

  it("closes the executor and propagates unexpected repository lookup failures", async () => {
    configurePostgres();
    query.mockRejectedValueOnce(new Error("repository lookup failed"));

    await expect(
      resolveRepositoryApiContext(
        sessionAuth([1001]),
        new Request("https://boardreadyops.test/api/v1/reviews?repositoryId=repo-1"),
      ),
    ).rejects.toThrow("repository lookup failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
