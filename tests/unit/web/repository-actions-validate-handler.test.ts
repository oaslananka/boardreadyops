import { describe, expect, it, vi } from "vitest";

const apiAuth = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  resolveRepositoryApiContext: vi.fn(),
}));

const setupStore = vi.hoisted(() => ({
  createSqlRepositorySetupStore: vi.fn(),
}));

const setupRoutes = vi.hoisted(() => ({
  handleRepositorySetupCreatePrForActor: vi.fn(),
  handleRepositorySetupProbeForActor: vi.fn(),
}));

vi.mock("../../../apps/web/lib/api-auth.js", () => apiAuth);
vi.mock("@boardreadyops/db/repository-setup-store", () => setupStore);
vi.mock("../../../apps/web/lib/repository-setup-routes.js", () => setupRoutes);

const { handleRepositoryAction } = await import("../../../apps/web/lib/repository-actions.js");

describe("repository readiness validation action", () => {
  it("routes a session-authorized repository validate action into the existing setup probe path", async () => {
    const close = vi.fn(async () => undefined);
    const executor = { query: vi.fn(async () => ({ rows: [{ installation_id: "installation-1" }] })), close };
    const store = {
      getContext: vi.fn(async () => ({
        installationId: "installation-1",
        githubInstallationId: 123,
        repositoryId: "repository-1",
        githubRepositoryId: 456,
        owner: "octo",
        name: "board",
        private: true,
        defaultBranch: "main",
      })),
    };

    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "viewer.github.42" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repository-1", executor });
    setupStore.createSqlRepositorySetupStore.mockReturnValue(store);
    setupRoutes.handleRepositorySetupProbeForActor.mockResolvedValue(
      Response.json(
        {
          ok: true,
          outcome: "dispatched",
          probeId: "22222222-2222-4222-8222-222222222222",
          workflowRunId: "987",
        },
        { status: 202 },
      ),
    );

    const response = await handleRepositoryAction(
      new Request("https://boardreadyops.example/api/v1/repositories/repository-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "validate", requestId: "ui-validate-1" }),
      }),
      "repository-1",
      {
        environment: {},
        readPermissions: async () => ({ actions: "write" }),
        now: () => new Date("2026-10-02T01:30:00.000Z"),
        newId: () => "generated-request-id",
      },
    );

    expect(response.status).toBe(202);
    expect(setupRoutes.handleRepositorySetupProbeForActor).toHaveBeenCalledWith(
      {
        actorId: "viewer.github.42",
        installationId: "installation-1",
        repositoryId: "repository-1",
        requestId: "ui-validate-1",
      },
      store,
      expect.objectContaining({
        githubClient: expect.any(Function),
        now: expect.any(Function),
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
