import { afterEach, describe, expect, it } from "vitest";
import {
  resetControlPlaneJobStoreForTests,
  setControlPlaneJobStoreForTests,
} from "../../../apps/web/app/api/github/webhook/intake-store.js";
import { POST } from "../../../apps/web/app/api/github/webhook/route.js";
import { resetWebhookRateLimitForTests } from "../../../apps/web/lib/webhook-rate-limit.js";
import { createGitHubSignatureHeader } from "../../../packages/cloud-core/src/index.js";

const trackedEnvironmentNames = [
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
  "BOARDREADYOPS_PERSISTENCE_MODE",
  "BOARDREADYOPS_RUNNER_MODE",
  "BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL",
  "BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE",
  "BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE",
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

function signedBodyRequest(event: string, body: string, secret = "test-secret", delivery = "delivery-123"): Request {
  return new Request("https://boardreadyops.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": delivery,
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

  resetControlPlaneJobStoreForTests();
  resetWebhookRateLimitForTests();
});

describe("GitHub webhook route lifecycle persistence", () => {
  it("durably accepts normalized lifecycle actions without executing them in the request", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
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
      intake: {
        outcome: "accepted",
        queued: true,
      },
      execution: {
        total: 0,
      },
    });
  });

  it("accepts a repeated delivery idempotently without creating another job", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";

    const first = await POST(signedGitHubRequest("installation", installationPayload()));
    const second = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ intake: { outcome: "accepted", queued: true } });
    await expect(second.json()).resolves.toMatchObject({ intake: { outcome: "duplicate", queued: false } });
  });

  it("does not persist a delivery with an invalid signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    const body = JSON.stringify(installationPayload());

    const invalid = await POST(signedBodyRequest("installation", body, "wrong-secret", "delivery-invalid"));
    const valid = await POST(signedBodyRequest("installation", body, "test-secret", "delivery-invalid"));

    expect(invalid.status).toBe(401);
    await expect(valid.json()).resolves.toMatchObject({ intake: { outcome: "accepted", queued: true } });
  });

  it("does not reserve a delivery id for malformed signed JSON", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";

    const malformed = await POST(signedBodyRequest("installation", "{not-json"));
    const valid = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(malformed.status).toBe(400);
    await expect(valid.json()).resolves.toMatchObject({ intake: { outcome: "accepted", queued: true } });
  });

  it("returns service unavailable without acknowledging a persistence outage", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    setControlPlaneJobStoreForTests({
      acceptGitHubWebhook: async () => {
        throw new Error("database unavailable");
      },
      claimJobs: async () => [],
      completeJob: async () => "stale",
      failJob: async () => "stale",
      purgeExpired: async () => 0,
      collectMetrics: async () => ({
        availableJobs: 0,
        leasedJobs: 0,
        deadLetterJobs: 0,
        duplicateDeliveries: 0,
        oldestUnprocessedAgeSeconds: 0,
      }),
    });

    const response = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "webhook could not be durably accepted",
    });
  });

  it("rejects an oversized payload before persistence", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    const request = new Request("https://boardreadyops.test/api/github/webhook", {
      method: "POST",
      headers: {
        "content-length": String(2 * 1024 * 1024 + 1),
        "x-github-delivery": "delivery-large",
        "x-github-event": "installation",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: "small",
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "webhook payload is too large" });
  });

  it("rate limits distinct verified deliveries while allowing GitHub to retry", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    process.env.BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE = "1";
    const body = JSON.stringify(installationPayload());

    const first = await POST(signedBodyRequest("installation", body, "test-secret", "delivery-rate-1"));
    const retry = await POST(signedBodyRequest("installation", body, "test-secret", "delivery-rate-1"));
    const limited = await POST(signedBodyRequest("installation", body, "test-secret", "delivery-rate-2"));

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("reports an invalid runner mode as disabled rather than failing open", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
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

  it("acknowledges ping events without requiring persistence", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const response = await POST(signedGitHubRequest("ping", { zen: "pong" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      event: "ping",
      delivery: "delivery-123",
      lifecycleActions: [],
      execution: { total: 0 },
    });
  });

  it("fails closed when PostgreSQL persistence is not configured", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const response = await POST(signedGitHubRequest("installation", installationPayload()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "cloud persistence is not configured",
      code: "missing-database-url",
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
