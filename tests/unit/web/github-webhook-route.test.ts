import { afterEach, describe, expect, it } from "vitest";
import { resetGitHubAppLifecycleStoreForTests } from "../../../apps/web/app/api/github/webhook/lifecycle-store.js";
import { POST } from "../../../apps/web/app/api/github/webhook/route.js";
import { createGitHubSignatureHeader } from "../../../packages/cloud-core/src/index.js";

const trackedEnvironmentNames = [
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
  "BOARDREADYOPS_RUNNER_MODE",
  "BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL",
  "BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE",
] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

function signedGitHubRequest(event: string, payload: unknown, secret = "test-secret"): Request {
  const body = JSON.stringify(payload);

  return new Request("https://boardreadyops.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": "delivery-123",
      "x-github-event": event,
      "x-hub-signature-256": createGitHubSignatureHeader(body, secret),
    },
    body,
  });
}

function installationPayload(): Record<string, unknown> {
  return {
    action: "created",
    installation: {
      id: 12345,
      account: {
        login: "octo-org",
        type: "Organization",
      },
    },
    repositories: [
      {
        id: 98765,
        name: "hardware-board",
        full_name: "octo-org/hardware-board",
        private: true,
        default_branch: "main",
        owner: {
          login: "octo-org",
        },
      },
    ],
  };
}

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  resetGitHubAppLifecycleStoreForTests();
});

describe("GitHub webhook route lifecycle persistence", () => {
  it("executes normalized lifecycle actions through the configured store", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    delete process.env.BOARDREADYOPS_RUNNER_MODE;

    const response = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      event: "installation",
      delivery: "delivery-123",
      runner: {
        mode: "github-actions",
        configurationValid: true,
        dispatch: "github-actions",
      },
      execution: {
        total: 2,
        installationsUpserted: 1,
        repositoriesUpserted: 1,
      },
    });
  });

  it("reports an invalid runner mode as disabled rather than failing open", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    process.env.BOARDREADYOPS_RUNNER_MODE = "automatic";

    const response = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runner: {
        mode: "disabled",
        configurationValid: false,
        configurationError: "invalid-runner-mode",
        dispatch: "none",
      },
    });
  });

  it("keeps unsupported lifecycle events acknowledged without executing actions", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;

    const response = await POST(signedGitHubRequest("issues", { action: "opened" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      event: "issues",
    });
  });
});
