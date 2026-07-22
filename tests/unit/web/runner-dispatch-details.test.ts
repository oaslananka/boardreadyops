import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRunnerClient } from "../../../apps/web/lib/runner-client.js";

const action = {
  type: "release_run.enqueue" as const,
  installation: { id: 12345 },
  repository: {
    id: 98765,
    owner: "octo-org",
    name: "hardware-board",
    fullName: "octo-org/hardware-board",
    private: false,
    defaultBranch: "main",
  },
  pullRequestNumber: 42,
  ref: "feature/ready",
  commitSha: "0123456789abcdef",
  triggerKind: "pr" as const,
};

describe("runner workflow dispatch details", () => {
  it("requests and returns the real GitHub workflow run ID", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const previous = { ...process.env };
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];

    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_API_BASE_URL = "https://github.test";
    process.env.BOARDREADYOPS_DISPATCH_WORKFLOW = "readiness-runner.yml";
    process.env.BOARDREADYOPS_PUBLIC_URL = "https://boardreadyops.test";

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      if (url === "https://api.github.com/app/installations/12345/access_tokens") {
        return Response.json(
          {
            token: "installation-token",
            expires_at: "2099-01-01T00:00:00Z",
            permissions: {},
            repository_selection: "all",
          },
          { status: 201, headers: { date: new Date().toUTCString() } },
        );
      }
      if (url.endsWith("/actions/workflows/readiness-runner.yml/dispatches")) {
        return Response.json({
          workflow_run_id: 456789,
          run_url: "https://api.github.test/repos/octo-org/hardware-board/actions/runs/456789",
          html_url: "https://github.test/octo-org/hardware-board/actions/runs/456789",
        });
      }
      if (url.endsWith("/check-runs/555")) return Response.json({});
      return new Response("not found", { status: 404 });
    };

    try {
      await expect(
        createRunnerClient().dispatchReleaseRunWorkflow({
          action,
          runId: "run-1",
          idempotencyKey: "98765:42:0123456789abcdef",
          githubCheckRunId: 555,
          executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        }),
      ).resolves.toEqual({
        workflowDispatchId: "456789",
        workflowRunUrl: "https://github.test/octo-org/hardware-board/actions/runs/456789",
      });
      expect(bodies[1]).toMatchObject({ return_run_details: true });
    } finally {
      globalThis.fetch = originalFetch;
      process.env = previous;
    }
  });
});
