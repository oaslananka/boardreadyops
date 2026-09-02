import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

import { type AuthenticatedApiContext, resolveReviewApiContext } from "../../../apps/web/lib/api-auth.js";

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

function bearerAuth(repositoryId: string): AuthenticatedApiContext {
  return {
    ok: true,
    repositoryId,
    actorId: "token-1",
    scopes: ["admin"],
    authType: "bearer_token",
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    review_id: "rev-123",
    repository_id: "repo-123",
    head_run_id: "run-123",
    current_revision_id: "revision-123",
    created_by: "octo-author",
    github_installation_id: "1001",
    ...overrides,
  };
}

describe("review API authorization context", () => {
  it("returns the authoritative review scope for an authorized session", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow()] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("expected review context");
    expect(result).toMatchObject({
      reviewId: "rev-123",
      repositoryId: "repo-123",
      headRunId: "run-123",
      currentRevisionId: "revision-123",
      createdBy: "octo-author",
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("github_marketplace_subscriptions");
    expect(close).not.toHaveBeenCalled();
    await result.executor.close();
  });

  it("falls back to 'system' when the review has no recorded author", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow({ created_by: null })] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("expected review context");
    expect(result.createdBy).toBe("system");
    await result.executor.close();
  });

  it("preserves a null current revision", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow({ current_revision_id: null })] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("expected review context");
    expect(result.currentRevisionId).toBeNull();
    await result.executor.close();
  });

  it("returns 404 when the review is outside the active durable scope", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [] });

    const result = await resolveReviewApiContext("rev-missing", sessionAuth([1001]));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["repository", { repository_id: { unsafe: true } }, "Invalid repository configuration"],
    ["head run", { head_run_id: { unsafe: true } }, "Invalid review head run configuration"],
    ["revision", { current_revision_id: { unsafe: true } }, "Invalid revision configuration"],
  ])("fails closed for an invalid %s identifier returned by PostgreSQL", async (_label, override, expectedError) => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow(override)] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    await expect((result as Response).clone().json()).resolves.toMatchObject({ error: expectedError });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the review installation id is unsafe", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow({ github_installation_id: "unsafe" })] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("denies a bearer token whose repository scope does not match the review", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow()] });

    const result = await resolveReviewApiContext("rev-123", bearerAuth("repo-other"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("denies a session whose installations do not include the review repository", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow()] });

    const result = await resolveReviewApiContext("rev-123", sessionAuth([9999]));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("allows a bearer token for the exact review repository", async () => {
    configurePostgres();
    query.mockResolvedValueOnce({ rows: [reviewRow()] });

    const result = await resolveReviewApiContext("rev-123", bearerAuth("repo-123"));

    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) await result.executor.close();
  });

  it("rejects review resolution when durable PostgreSQL persistence is disabled", async () => {
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    delete process.env.DATABASE_URL;

    const result = await resolveReviewApiContext("rev-123", sessionAuth([1001]));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("closes the executor and propagates unexpected review lookup failures", async () => {
    configurePostgres();
    query.mockRejectedValueOnce(new Error("review lookup failed"));

    await expect(resolveReviewApiContext("rev-123", sessionAuth([1001]))).rejects.toThrow("review lookup failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
