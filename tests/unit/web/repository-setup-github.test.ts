import { describe, expect, it, vi } from "vitest";
import { createRepositorySetupGitHubClient } from "../../../apps/web/lib/repository-setup-github.js";

function client(responses: Response[]) {
  const request = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () => responses.shift() ?? new Response("not found", { status: 404 }),
  );
  const authFactory = vi.fn(() => vi.fn(async () => ({ token: "installation-token" })));
  return {
    request,
    authFactory,
    client: createRepositorySetupGitHubClient({
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GITHUB_API_BASE_URL: "https://github.test",
        BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.test",
      },
      authFactory,
      request,
    }),
  };
}

describe("repository setup GitHub client", () => {
  it("reports Actions unavailable from the workflow endpoint without requiring Administration permission", async () => {
    const { client: setup, request } = client([new Response("forbidden", { status: 403 })]);
    await expect(setup.inspect({ githubInstallationId: 12, owner: "octo-org", name: "board" })).resolves.toEqual({
      actionsEnabled: false,
      workflowStatus: "actions_disabled",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0]?.[0])).toContain("/actions/workflows/readiness-runner.yml");
    expect(String(request.mock.calls[0]?.[0])).not.toContain("/actions/permissions");
  });

  it("distinguishes missing, disabled, incompatible and probe-ready workflows", async () => {
    const missing = client([new Response("", { status: 404 })]).client;
    await expect(
      missing.inspect({ githubInstallationId: 12, owner: "octo-org", name: "board" }),
    ).resolves.toMatchObject({ workflowStatus: "missing" });

    const disabled = client([
      Response.json({
        id: 4,
        name: "BoardReadyOps Readiness Runner",
        path: ".github/workflows/readiness-runner.yml",
        state: "disabled_manually",
      }),
    ]).client;
    await expect(
      disabled.inspect({ githubInstallationId: 12, owner: "octo-org", name: "board" }),
    ).resolves.toMatchObject({ workflowStatus: "disabled" });

    const incompatible = client([
      Response.json({ id: 4, name: "Other workflow", path: ".github/workflows/readiness-runner.yml", state: "active" }),
    ]).client;
    await expect(
      incompatible.inspect({ githubInstallationId: 12, owner: "octo-org", name: "board" }),
    ).resolves.toMatchObject({ workflowStatus: "incompatible" });

    const ready = client([
      Response.json({
        id: 4,
        name: "BoardReadyOps Readiness Runner",
        path: ".github/workflows/readiness-runner.yml",
        state: "active",
      }),
    ]).client;
    await expect(ready.inspect({ githubInstallationId: 12, owner: "octo-org", name: "board" })).resolves.toMatchObject({
      workflowStatus: "probe_required",
      workflowId: 4,
    });
  });

  it("dispatches a run-bound setup probe without Contents permission", async () => {
    const { client: setup, request } = client([
      Response.json({ workflow_run_id: 987, html_url: "https://github.test/actions/runs/987" }),
    ]);
    await expect(
      setup.dispatchProbe({
        githubInstallationId: 12,
        owner: "octo-org",
        name: "board",
        defaultBranch: "main",
        probeId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({ workflowRunId: "987", workflowRunUrl: "https://github.test/actions/runs/987" });
    const init = request.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        ref: "main",
        inputs: expect.objectContaining({
          setup_probe_id: "11111111-1111-4111-8111-111111111111",
          setup_result_url:
            "https://boardreadyops.test/api/v1/setup-probes/result?probe_id=11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });
});
