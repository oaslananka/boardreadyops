import { beforeEach, describe, expect, it, vi } from "vitest";

const apiAuth = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  resolveRepositoryApiContext: vi.fn(),
}));

const repositorySetupStore = vi.hoisted(() => ({
  getContext: vi.fn(),
}));

vi.mock("../../../apps/web/lib/api-auth.js", () => apiAuth);
vi.mock("@boardreadyops/db/repository-setup-store", () => ({
  createSqlRepositorySetupStore: () => ({ getContext: repositorySetupStore.getContext }),
}));

const { handleRepositoryAction } = await import("../../../apps/web/lib/repository-actions.js");

describe("repository action failure contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a stable safe recovery category and correlates queue failures with server telemetry", async () => {
    const databaseError = Object.assign(new Error("column base_commit_sha does not exist"), { code: "42703" });
    const close = vi.fn(async () => undefined);
    const executor = {
      query: vi.fn(async () => {
        throw databaseError;
      }),
      close,
    };
    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "actor-1" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repo-1", executor });

    const logLines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      logLines.push(String(chunk));
      return true;
    });

    try {
      const response = await handleRepositoryAction(
        new Request("https://boardreadyops.example/api/v1/repositories/repo-1/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rerun", runId: "run-1" }),
        }),
        "repo-1",
        {
          environment: {},
          readPermissions: async () => undefined,
          now: () => new Date("2026-10-01T04:35:02.000Z"),
          newId: () => "request-correlation-1",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "The action could not be queued. Please try again.",
        code: "repository_action_queue_failed",
        recovery: "retry",
        requestId: "request-correlation-1",
      });
      expect(close).toHaveBeenCalledOnce();

      const telemetry = logLines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry.event === "repository.action");
      expect(telemetry).toMatchObject({
        action: "rerun",
        outcome: "failed",
        errorClass: "Error",
        errorCode: "42703",
        requestId: "request-correlation-1",
      });
    } finally {
      write.mockRestore();
    }
  });

  it("returns a GitHub access recovery with the installation remedy and correlation id", async () => {
    const close = vi.fn(async () => undefined);
    const executor = {
      query: vi.fn(async () => ({ rows: [{ installation_id: "inst-1" }] })),
      close,
    };
    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "actor-1" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repo-1", executor });
    repositorySetupStore.getContext.mockResolvedValue({
      installationId: "inst-1",
      githubInstallationId: 123,
      repositoryId: "repo-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board-one",
      private: false,
      defaultBranch: "main",
    });

    const response = await handleRepositoryAction(
      new Request("https://boardreadyops.example/api/v1/repositories/repo-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rerun", runId: "run-1" }),
      }),
      "repo-1",
      {
        environment: {},
        readPermissions: async () => ({}),
        now: () => new Date("2026-10-01T04:35:02.000Z"),
        newId: () => "request-access-1",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "repository_action_permission_required",
      recovery: "github_access",
      requestId: "request-access-1",
      manageUrl: "https://github.com/settings/installations/123",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns refresh recovery when the requested run is no longer available", async () => {
    const close = vi.fn(async () => undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ installation_id: "inst-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const executor = { query, close };

    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "actor-1" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repo-1", executor });
    repositorySetupStore.getContext.mockResolvedValue({
      installationId: "inst-1",
      githubInstallationId: 123,
      repositoryId: "repo-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board-one",
      private: false,
      defaultBranch: "main",
    });

    const response = await handleRepositoryAction(
      new Request("https://boardreadyops.example/api/v1/repositories/repo-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rerun", runId: "run-missing" }),
      }),
      "repo-1",
      {
        environment: {},
        readPermissions: async () => undefined,
        now: () => new Date("2026-10-01T04:35:02.000Z"),
        newId: () => "request-refresh-1",
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "That run is no longer available.",
      code: "repository_action_run_unavailable",
      recovery: "refresh",
      requestId: "request-refresh-1",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns open-pull-request recovery when the run came from a branch push", async () => {
    const close = vi.fn(async () => undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ installation_id: "inst-1" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-branch",
            ref: "refs/heads/topic",
            commit_sha: "a".repeat(40),
            base_commit_sha: null,
            pull_request_number: null,
          },
        ],
      });
    const executor = { query, close };

    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "actor-1" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repo-1", executor });
    repositorySetupStore.getContext.mockResolvedValue({
      installationId: "inst-1",
      githubInstallationId: 123,
      repositoryId: "repo-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board-one",
      private: false,
      defaultBranch: "main",
    });

    const response = await handleRepositoryAction(
      new Request("https://boardreadyops.example/api/v1/repositories/repo-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release-preview", runId: "run-branch" }),
      }),
      "repo-1",
      {
        environment: {},
        readPermissions: async () => undefined,
        now: () => new Date("2026-10-01T04:35:02.000Z"),
        newId: () => "request-open-pr-1",
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "repository_action_requires_pull_request",
      recovery: "open_pull_request",
      requestId: "request-open-pr-1",
    });
    expect(close).toHaveBeenCalledOnce();
  });

});
