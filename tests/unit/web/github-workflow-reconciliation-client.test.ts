import { describe, expect, it, vi } from "vitest";
import {
  createGitHubWorkflowReconciliationClient,
  readGitHubWorkflowRun,
} from "../../../apps/web/lib/github-workflow-reconciliation-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub workflow reconciliation reader", () => {
  it("reads one workflow through the supplied installation token and returns safe state only", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        id: 987,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.example/private/run/987",
        logs_url: "https://github.example/private/logs",
        head_commit: { message: "private commit message" },
      }),
    );

    await expect(
      readGitHubWorkflowRun({
        apiBaseUrl: "https://github.test/api/v3",
        token: "installation-token",
        repositoryOwner: "octo-org",
        repositoryName: "board",
        workflowRunId: "987",
        request,
      }),
    ).resolves.toEqual({ kind: "completed", conclusion: "success" });

    expect(request).toHaveBeenCalledWith("https://github.test/api/v3/repos/octo-org/board/actions/runs/987", {
      method: "GET",
      headers: expect.objectContaining({ authorization: "Bearer installation-token" }),
    });
  });

  it("maps queued workflow state and a 404 without returning response content", async () => {
    const pendingRequest = vi.fn(async () => jsonResponse({ id: 987, status: "in_progress", conclusion: null }));
    await expect(
      readGitHubWorkflowRun({
        apiBaseUrl: "https://api.github.com",
        token: "token",
        repositoryOwner: "octo",
        repositoryName: "board",
        workflowRunId: "987",
        request: pendingRequest,
      }),
    ).resolves.toEqual({ kind: "pending", status: "in_progress" });

    const missingRequest = vi.fn(async () => jsonResponse({ message: "private repository detail" }, 404));
    await expect(
      readGitHubWorkflowRun({
        apiBaseUrl: "https://api.github.com",
        token: "token",
        repositoryOwner: "octo",
        repositoryName: "board",
        workflowRunId: "987",
        request: missingRequest,
      }),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("uses the claimed GitHub installation id for short-lived authentication", async () => {
    const request = vi.fn(async () => jsonResponse({ id: 987, status: "queued", conclusion: null }));
    const installationAuth = vi.fn(async () => ({ token: "short-lived-token" }));
    const authFactory = vi.fn(() => installationAuth);
    const client = createGitHubWorkflowReconciliationClient({
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GITHUB_API_BASE_URL: "https://github.test/api/v3",
      },
      authFactory,
      request,
    });

    await expect(
      client.readWorkflowRun({
        githubInstallationId: 456,
        repositoryOwner: "octo",
        repositoryName: "board",
        workflowRunId: "987",
      }),
    ).resolves.toEqual({ kind: "pending", status: "queued" });

    expect(authFactory).toHaveBeenCalledWith({ appId: "123", privateKey: "private-key", installationId: 456 });
    expect(installationAuth).toHaveBeenCalledWith({ type: "installation" });
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      method: "GET",
      headers: expect.objectContaining({ authorization: "Bearer short-lived-token" }),
    });
  });

  it("fails with status-only errors and never includes GitHub response bodies", async () => {
    const request = vi.fn(async () => jsonResponse({ message: "token=do-not-leak private repository name" }, 503));

    await expect(
      readGitHubWorkflowRun({
        apiBaseUrl: "https://api.github.com",
        token: "secret-token",
        repositoryOwner: "octo",
        repositoryName: "board",
        workflowRunId: "987",
        request,
      }),
    ).rejects.toThrow("GitHub workflow lookup failed with status 503");
    await expect(
      readGitHubWorkflowRun({
        apiBaseUrl: "https://api.github.com",
        token: "secret-token",
        repositoryOwner: "octo",
        repositoryName: "board",
        workflowRunId: "987",
        request,
      }),
    ).rejects.not.toThrow("do-not-leak");
  });
});
