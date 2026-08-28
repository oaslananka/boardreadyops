import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../apps/web/app/api/github/marketplace/webhook/route.js";
import { createGitHubSignatureHeader } from "../../../packages/cloud-core/src/index.js";
import * as pgExecutorModule from "../../../packages/db/src/pg-executor.js";

const trackedEnvironmentNames = [
  "GITHUB_MARKETPLACE_WEBHOOK_SECRET",
  "DATABASE_URL",
  "BOARDREADYOPS_PERSISTENCE_MODE",
] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

function sampleMarketplacePurchasePayload(action = "purchased", planName = "Community"): Record<string, unknown> {
  return {
    action,
    effective_date: "2026-08-28T00:00:00Z",
    installation: { id: 12345 },
    sender: { id: 111, login: "octocat" },
    marketplace_purchase: {
      account: { id: 999, login: "octo-org", type: "Organization" },
      billing_cycle: "monthly",
      unit_count: 1,
      on_free_trial: false,
      free_trial_ends_on: null,
      next_billing_date: "2026-09-28T00:00:00Z",
      plan: {
        id: 101,
        name: planName,
        description: "Community Free plan for hardware teams",
        monthly_price_in_cents: 0,
        yearly_price_in_cents: 0,
        price_model: "free",
        has_free_trial: false,
        unit_name: null,
        bullets: ["Automated KiCad checks", "Single watched board"],
      },
    },
  };
}

function signedMarketplaceRequest(
  event: string,
  payload: unknown,
  secret = "test-marketplace-secret",
  delivery = "del-marketplace-123",
): Request {
  return signedBodyRequest(event, JSON.stringify(payload), secret, delivery);
}

function signedBodyRequest(
  event: string,
  body: string,
  secret = "test-marketplace-secret",
  delivery = "del-marketplace-123",
): Request {
  return new Request("https://boardreadyops.test/api/github/marketplace/webhook", {
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

function postgresResult(
  row: { inserted?: boolean; state_changed?: boolean; stale?: boolean; erasure_queued?: boolean } = {},
) {
  process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
  process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        inserted: row.inserted ?? true,
        state_changed: row.state_changed ?? true,
        stale: row.stale ?? false,
        erasure_queued: row.erasure_queued ?? false,
      },
    ],
  });
  const close = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query, close } as never);
  return { query, close };
}

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("POST /api/github/marketplace/webhook", () => {
  it("fails closed with 503 when GITHUB_MARKETPLACE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload()));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Marketplace webhook secret is not configured",
    });
  });

  it("rejects invalid signature with 401", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const response = await POST(
      signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload(), "wrong-secret"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid webhook signature" });
  });

  it("rejects invalid routing headers with 400", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const request = new Request("https://boardreadyops.test/api/github/marketplace/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-delivery": "", "x-github-event": "invalid event" },
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "webhook routing headers are invalid" });
  });

  it("rejects oversized payloads with 413", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const request = new Request("https://boardreadyops.test/api/github/marketplace/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 10),
        "x-github-delivery": "del-large",
        "x-github-event": "marketplace_purchase",
        "x-hub-signature-256": "sha256=abcdef",
      },
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "webhook payload is too large" });
  });

  it("rejects malformed signed JSON with 400", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const response = await POST(signedBodyRequest("marketplace_purchase", "{not-valid-json"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "webhook payload is not valid JSON" });
  });

  it("acknowledges ping event with 200", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const response = await POST(signedMarketplaceRequest("ping", { zen: "Design for assembly." }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "accepted",
      event: "ping",
      delivery: "del-marketplace-123",
    });
  });

  it("safely acknowledges unknown events with 200", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const response = await POST(signedMarketplaceRequest("star", { action: "created" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: "unsupported_event",
      event: "star",
      delivery: "del-marketplace-123",
    });
  });

  it("fails closed when durable persistence is not configured", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Marketplace persistence is not configured" });
  });

  it("rejects stateful payloads without a stable GitHub account id", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const payload = sampleMarketplacePurchasePayload();
    (payload.marketplace_purchase as { account: Record<string, unknown> }).account.id = 0;
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", payload));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid marketplace purchase payload" });
  });

  it("rejects an invalid effective_date", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    const payload = sampleMarketplacePurchasePayload();
    payload.effective_date = "not-a-date";
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", payload));
    expect(response.status).toBe(400);
  });

  it("processes purchased atomically and pins the listing tier to free", async () => {
    const { query, close } = postgresResult();
    const response = await POST(
      signedMarketplaceRequest(
        "marketplace_purchase",
        sampleMarketplacePurchasePayload("purchased", "Team Enterprise"),
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, processed: true, action: "purchased", tier: "free" });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("github_marketplace_subscriptions");
    expect(params).toContain(999);
    expect(params).toContain(12345);
    expect(params).toContain("free");
    expect(close).toHaveBeenCalled();
  });

  it("handles duplicate delivery idempotently", async () => {
    postgresResult({ inserted: false, state_changed: false });
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true, delivery: "del-marketplace-123" });
  });

  it("records a stale purchased event without regressing current state", async () => {
    postgresResult({ inserted: true, state_changed: false, stale: true });
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "purchased",
      tier: "free",
      stale: true,
    });
  });

  it("processes cancellation and queues the 30-day erasure lifecycle", async () => {
    const { query } = postgresResult({ erasure_queued: true });
    const response = await POST(
      signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("cancelled")),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "cancelled",
      tier: "free",
      erasureQueued: true,
    });
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain("INTERVAL '30 days'");
    expect(sql).toContain("legal_holds");
  });

  it("records changed defensively without granting a paid entitlement", async () => {
    postgresResult({ state_changed: false });
    const response = await POST(
      signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("changed", "Business")),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "changed",
      tier: "free",
      stateChanged: false,
    });
  });

  it("records pending_change without applying subscription state", async () => {
    postgresResult({ state_changed: false });
    const response = await POST(
      signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("pending_change")),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "pending_change",
      pending: true,
    });
  });

  it("safely records and ignores unknown marketplace actions", async () => {
    postgresResult({ state_changed: false });
    const response = await POST(
      signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("custom_action")),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: "unsupported_action",
      action: "custom_action",
    });
  });

  it("returns 503 when the atomic persistence statement fails", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({
      query: vi.fn().mockRejectedValue(new Error("connection terminated")),
      close,
    } as never);
    const response = await POST(signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Marketplace webhook could not be durably accepted",
    });
    expect(close).toHaveBeenCalled();
  });
});
