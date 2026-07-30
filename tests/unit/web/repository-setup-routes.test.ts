import { describe, expect, it, vi } from "vitest";
import {
  handleRepositorySetupGet,
  handleRepositorySetupPost,
  type RepositorySetupRouteDependencies,
} from "../../../apps/web/lib/repository-setup-routes.js";
import type { RepositorySetupStore } from "../../../packages/db/src/repository-setup-store.js";

const token = "operator-token-".padEnd(48, "x");
const installationId = "installation-1";
const repositoryId = "repository-1";
const executor = { query: vi.fn() };
const current = {
  id: "11111111-1111-4111-8111-111111111111",
  installationId,
  repositoryId,
  revision: 1,
  preset: "production" as const,
  presetVersion: 1,
  source: "operator" as const,
  actorId: "operator.primary",
  requestId: "select-1",
  workflowPath: "readiness-runner.yml" as const,
  workflowStatus: "unknown" as const,
  configStatus: "unknown" as const,
  diagnostics: [],
  createdAt: "2026-07-30T06:00:00.000Z",
};
const context = {
  installationId,
  githubInstallationId: 123,
  repositoryId,
  githubRepositoryId: 456,
  owner: "octo",
  name: "board",
  private: true,
  defaultBranch: "main",
  current,
};

function store(overrides: Partial<RepositorySetupStore> = {}): RepositorySetupStore {
  return {
    getContext: vi.fn(async () => context),
    listRevisions: vi.fn(async () => [current]),
    applyRevision: vi.fn<RepositorySetupStore["applyRevision"]>(async () => ({
      outcome: "applied",
      revisionId: current.id,
      revision: 1,
    })),
    createProbe: vi.fn<RepositorySetupStore["createProbe"]>(async () => ({
      outcome: "created",
      probeId: "22222222-2222-4222-8222-222222222222",
      setupRevisionId: current.id,
    })),
    getProbe: vi.fn(async () => undefined),
    markProbeDispatched: vi.fn(async () => "applied"),
    failProbe: vi.fn(async () => "applied"),
    completeProbe: vi.fn(async () => ({ outcome: "completed" })),
    ...overrides,
  };
}

function dependencies(
  setupStore = store(),
  githubOverrides: Record<string, unknown> = {},
): RepositorySetupRouteDependencies {
  return {
    environment: {
      BOARDREADYOPS_OPERATOR_API_TOKEN: token,
      BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
      DATABASE_URL: "postgresql://example.invalid/database",
    },
    queryExecutor: vi.fn(() => executor),
    createStore: vi.fn(() => setupStore),
    githubClient: vi.fn(() => ({
      inspect: vi.fn(async () => ({ actionsEnabled: true, workflowStatus: "probe_required" as const, workflowId: 5 })),
      dispatchProbe: vi.fn(async () => ({
        workflowRunId: "987",
        workflowRunUrl: "https://github.test/actions/runs/987",
      })),
      ...githubOverrides,
    })),
    now: () => new Date("2026-07-30T06:00:00.000Z"),
  } as RepositorySetupRouteDependencies;
}

function request(method: string, body?: unknown, authorization = `Bearer ${token}`): Request {
  return new Request("https://boardreadyops.test/setup", {
    method,
    headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("repository setup operator routes", () => {
  it("returns presets, least-privilege instructions, history and GitHub readiness", async () => {
    const response = await handleRepositorySetupGet(request("GET"), installationId, repositoryId, dependencies());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      repository: { fullName: "octo/board", private: true, defaultBranch: "main" },
      current: { preset: "production" },
      github: { workflowStatus: "probe_required" },
      permissions: { repository: { contents: "none", actions: "write", checks: "write" } },
      assistedInstallation: { available: false, explicitOptInRequired: true },
    });
    expect(payload.presets as unknown[]).toHaveLength(4);
    expect(JSON.stringify(payload)).not.toContain("installation-token");
  });

  it("selects a versioned preset idempotently", async () => {
    const setupStore = store();
    const response = await handleRepositorySetupPost(
      request("POST", { action: "select_preset", preset: "prototype", requestId: "select-2" }),
      installationId,
      repositoryId,
      dependencies(setupStore),
    );
    expect(response.status).toBe(201);
    expect(setupStore.applyRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "prototype",
        presetVersion: 1,
        actorId: "operator.primary",
        workflowStatus: "unknown",
        configStatus: "unknown",
      }),
    );
  });

  it("records unavailable readiness with a bounded namespaced request id", async () => {
    const setupStore = store();
    const requestId = `r${"x".repeat(127)}`;
    const response = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId }),
      installationId,
      repositoryId,
      dependencies(setupStore, {
        inspect: vi.fn(async () => ({ actionsEnabled: false, workflowStatus: "actions_disabled" })),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("confirm the App has Actions read/write permission"),
    });
    const applied = vi.mocked(setupStore.applyRevision).mock.calls[0]?.[0];
    expect(applied?.requestId).toMatch(/^readiness:[0-9a-f]{64}$/u);
    expect(applied?.requestId.length).toBeLessThanOrEqual(128);
  });

  it.each([
    ["completed", 200],
    ["expired", 410],
    ["failed", 409],
  ] as const)("reports replayed %s probes truthfully", async (status, expectedStatus) => {
    const setupStore = store({
      createProbe: vi.fn<RepositorySetupStore["createProbe"]>(async () => ({
        outcome: "replayed",
        probeId: "22222222-2222-4222-8222-222222222222",
        setupRevisionId: current.id,
      })),
      getProbe: vi.fn<RepositorySetupStore["getProbe"]>(async () => ({
        probeId: "22222222-2222-4222-8222-222222222222",
        installationId,
        githubInstallationId: 123,
        repositoryId,
        githubRepositoryId: 456,
        owner: "octo",
        name: "board",
        defaultBranch: "main",
        preset: "production",
        presetVersion: 1,
        status,
        expiresAt: "2026-07-30T07:00:00.000Z",
      })),
    });
    const response = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId: `replay-${status}` }),
      installationId,
      repositoryId,
      dependencies(setupStore),
    );
    expect(response.status).toBe(expectedStatus);
    if (status === "completed") {
      expect(await response.json()).toMatchObject({ outcome: "replayed", status: "completed" });
    }
  });

  it("dispatches a setup probe and persists the workflow run id", async () => {
    const setupStore = store();
    const response = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId: "probe-1" }),
      installationId,
      repositoryId,
      dependencies(setupStore),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ outcome: "dispatched", workflowRunId: "987" });
    expect(setupStore.createProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId,
        repositoryId,
        requestedBy: "operator.primary",
        expiresAt: new Date("2026-07-30T06:15:00.000Z"),
      }),
    );
    expect(setupStore.markProbeDispatched).toHaveBeenCalledWith({
      probeId: "22222222-2222-4222-8222-222222222222",
      workflowRunId: "987",
    });
  });

  it("converges when the setup callback completes before dispatch persistence", async () => {
    const setupStore = store({
      markProbeDispatched: vi.fn(async () => "stale"),
      getProbe: vi.fn<RepositorySetupStore["getProbe"]>(async () => ({
        probeId: "22222222-2222-4222-8222-222222222222",
        installationId,
        githubInstallationId: 123,
        repositoryId,
        githubRepositoryId: 456,
        owner: "octo",
        name: "board",
        defaultBranch: "main",
        preset: "production",
        presetVersion: 1,
        status: "completed",
        expiresAt: "2026-07-30T07:00:00.000Z",
      })),
    });
    const response = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId: "probe-race" }),
      installationId,
      repositoryId,
      dependencies(setupStore),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "completed", workflowRunId: "987" });
  });

  it("fails closed for unavailable workflows and dispatch failures", async () => {
    const unavailableStore = store();
    const unavailable = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId: "probe-2" }),
      installationId,
      repositoryId,
      dependencies(unavailableStore, {
        inspect: vi.fn(async () => ({ actionsEnabled: false, workflowStatus: "actions_disabled" })),
      }),
    );
    expect(unavailable.status).toBe(409);
    expect(unavailableStore.applyRevision).toHaveBeenCalledWith(
      expect.objectContaining({ workflowStatus: "actions_disabled" }),
    );

    const failedStore = store();
    const failed = await handleRepositorySetupPost(
      request("POST", { action: "probe", requestId: "probe-3" }),
      installationId,
      repositoryId,
      dependencies(failedStore, {
        dispatchProbe: vi.fn(async () => {
          throw new Error("authorization=secret");
        }),
      }),
    );
    expect(failed.status).toBe(502);
    expect(failedStore.failProbe).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "dispatch_failed" }));
    expect(JSON.stringify(await failed.json())).not.toContain("authorization");
  });

  it("rejects oversized setup bodies before database access", async () => {
    const deps = dependencies();
    const oversized = new Request("https://boardreadyops.test/setup", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "select_preset", padding: "x".repeat(33 * 1024) }),
    });
    expect((await handleRepositorySetupPost(oversized, installationId, repositoryId, deps)).status).toBe(400);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("rejects unauthorized and malformed operations before database access", async () => {
    const deps = dependencies();
    const unauthorized = await handleRepositorySetupGet(
      request("GET", undefined, "Bearer invalid"),
      installationId,
      repositoryId,
      deps,
    );
    expect(unauthorized.status).toBe(401);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
    const invalid = await handleRepositorySetupPost(
      request("POST", { action: "select_preset", preset: "unknown", requestId: "x" }),
      installationId,
      repositoryId,
      deps,
    );
    expect(invalid.status).toBe(400);
  });
});
