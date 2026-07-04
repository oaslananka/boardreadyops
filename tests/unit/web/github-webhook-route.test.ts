import { afterEach, describe, expect, it } from "vitest";
import { resetGitHubAppLifecycleStoreForTests } from "../../../apps/web/app/api/github/webhook/lifecycle-store.js";
import { POST } from "../../../apps/web/app/api/github/webhook/route.js";
import { createGitHubSignatureHeader } from "../../../packages/cloud-core/src/index.js";

const originalWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;

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

afterEach(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
  }

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  resetGitHubAppLifecycleStoreForTests();
});

describe("GitHub webhook route lifecycle persistence", () => {
  it("executes normalized lifecycle actions through the configured store", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;

    const response = await POST(
      signedGitHubRequest("installation", {
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
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      event: "installation",
      delivery: "delivery-123",
      execution: {
        total: 2,
        installationsUpserted: 1,
        repositoriesUpserted: 1,
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
