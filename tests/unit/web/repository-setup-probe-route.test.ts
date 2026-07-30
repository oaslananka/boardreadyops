import { describe, expect, it, vi } from "vitest";
import {
  handleRepositorySetupProbeResult,
  type RepositorySetupProbeRouteDependencies,
} from "../../../apps/web/lib/repository-setup-probe-route.js";

const probeId = "11111111-1111-4111-8111-111111111111";
const token = "x".repeat(120);
const executor = { query: vi.fn() };

function request(body: unknown, authorization = `Bearer ${token}`): Request {
  return new Request(`https://boardreadyops.test/api/v1/setup-probes/result?probe_id=${probeId}`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<RepositorySetupProbeRouteDependencies> = {},
): RepositorySetupProbeRouteDependencies {
  const getProbe = vi.fn(async () => ({
    probeId,
    installationId: "installation-1",
    githubInstallationId: 123,
    repositoryId: "repository-1",
    githubRepositoryId: 456,
    owner: "octo",
    name: "board",
    defaultBranch: "main",
    preset: "production" as const,
    presetVersion: 1,
    status: "dispatched" as const,
    expiresAt: "2026-07-30T07:00:00.000Z",
  }));
  const completeProbe = vi.fn(async () => ({
    outcome: "completed",
    revisionId: "22222222-2222-4222-8222-222222222222",
    revision: 2,
  }));
  return {
    queryExecutor: vi.fn(() => executor),
    createStore: vi.fn(() => ({ getProbe, completeProbe })),
    verifyOidc: vi.fn(async () => true),
    ...overrides,
  } as RepositorySetupProbeRouteDependencies;
}

describe("repository setup probe callback", () => {
  it("binds OIDC to repository, workflow, branch, repository id and probe audience", async () => {
    const deps = dependencies();
    const response = await handleRepositorySetupProbeResult(
      request({
        contractVersion: 1,
        configStatus: "ready",
        configVersion: 1,
        observedSha: "a".repeat(40),
        diagnostics: [],
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.verifyOidc).toHaveBeenCalledWith(token, {
      runId: probeId,
      audience: `boardreadyops-setup:${probeId}`,
      repository: "octo/board",
      repositoryId: "456",
      workflowRef: "octo/board/.github/workflows/readiness-runner.yml@refs/heads/main",
      ref: "refs/heads/main",
      sha: "a".repeat(40),
    });
    expect(await response.json()).toEqual({
      ok: true,
      outcome: "completed",
      revisionId: "22222222-2222-4222-8222-222222222222",
      revision: 2,
    });
  });

  it("rejects malformed, unauthenticated and untrusted results before mutation", async () => {
    const deps = dependencies();
    expect((await handleRepositorySetupProbeResult(request({ configStatus: "ready" }), deps)).status).toBe(400);
    expect(
      (
        await handleRepositorySetupProbeResult(
          request(
            {
              contractVersion: 1,
              configStatus: "ready",
              configVersion: 1,
              observedSha: "a".repeat(40),
              diagnostics: [],
            },
            "",
          ),
          deps,
        )
      ).status,
    ).toBe(401);
    const untrusted = dependencies({ verifyOidc: vi.fn(async () => false) });
    expect(
      (
        await handleRepositorySetupProbeResult(
          request({
            contractVersion: 1,
            configStatus: "ready",
            configVersion: 1,
            observedSha: "a".repeat(40),
            diagnostics: [],
          }),
          untrusted,
        )
      ).status,
    ).toBe(401);
  });

  it("rejects oversized callbacks before database access", async () => {
    const deps = dependencies();
    const response = await handleRepositorySetupProbeResult(request({ padding: "x".repeat(17 * 1024) }), deps);
    expect(response.status).toBe(400);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("maps expired and stale database outcomes without leaking internals", async () => {
    for (const [outcome, status] of [
      ["expired", 410],
      ["stale", 409],
      ["not_found", 404],
    ] as const) {
      const deps = dependencies({
        createStore: vi.fn(() => ({
          getProbe: vi.fn(async () => ({
            probeId,
            installationId: "installation-1",
            githubInstallationId: 123,
            repositoryId: "repository-1",
            githubRepositoryId: 456,
            owner: "octo",
            name: "board",
            defaultBranch: "main",
            preset: "production" as const,
            presetVersion: 1,
            status: "dispatched" as const,
            expiresAt: "2026-07-30T07:00:00.000Z",
          })),
          completeProbe: vi.fn(async () => ({ outcome })),
        })),
      });
      const response = await handleRepositorySetupProbeResult(
        request({ contractVersion: 1, configStatus: "missing", observedSha: "a".repeat(40), diagnostics: ["missing"] }),
        deps,
      );
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain("password");
    }
  });
});
