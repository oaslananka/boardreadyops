import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../apps/web/app/api/github/marketplace/webhook/route.js";
import { createGitHubSignatureHeader } from "../../../packages/cloud-core/src/index.js";
import * as dbModule from "../../../packages/db/src/index.js";
import * as pgExecutorModule from "../../../packages/db/src/pg-executor.js";

const trackedEnvironmentNames = [
  "GITHUB_MARKETPLACE_WEBHOOK_SECRET",
  "DATABASE_URL",
  "BOARDREADYOPS_PERSISTENCE_MODE",
] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

function signedMarketplaceRequest(
  event: string,
  payload: unknown,
  secret = "test-marketplace-secret",
  delivery = "del-marketplace-123",
): Request {
  const body = JSON.stringify(payload);
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

function sampleMarketplacePurchasePayload(action = "purchased", planName = "Community"): Record<string, unknown> {
  return {
    action,
    effective_date: "2026-08-28T00:00:00Z",
    sender: {
      id: 111,
      login: "octocat",
    },
    marketplace_purchase: {
      account: {
        id: 999,
        login: "octo-org",
        type: "Organization",
      },
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

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  vi.restoreAllMocks();
});

describe("POST /api/github/marketplace/webhook", () => {
  it("fails closed with 503 when GITHUB_MARKETPLACE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload());
    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Marketplace webhook secret is not configured",
    });
  });

  it("rejects invalid signature with 401", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";

    const request = signedMarketplaceRequest(
      "marketplace_purchase",
      sampleMarketplacePurchasePayload(),
      "wrong-secret",
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid webhook signature",
    });
  });

  it("rejects invalid routing headers with 400", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";

    const request = new Request("https://boardreadyops.test/api/github/marketplace/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "",
        "x-github-event": "invalid event with spaces",
      },
      body: "{}",
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "webhook routing headers are invalid",
    });
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
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "webhook payload is too large",
    });
  });

  it("rejects malformed signed JSON with 400", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";

    const request = signedBodyRequest("marketplace_purchase", "{not-valid-json");
    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "webhook payload is not valid JSON",
    });
  });

  it("acknowledges ping event with 200", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";

    const request = signedMarketplaceRequest("ping", { zen: "Design for assembly." });
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "accepted",
      event: "ping",
      delivery: "del-marketplace-123",
    });
  });

  it("safely acknowledges unknown events with 200 without retrying", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";

    const request = signedMarketplaceRequest("star", { action: "created" });
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: "unsupported_event",
      event: "star",
      delivery: "del-marketplace-123",
    });
  });

  it("accepts marketplace purchase in memory/no-db mode", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload());
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      received: true,
      mode: "no-db",
      action: "purchased",
      delivery: "del-marketplace-123",
    });
  });

  it("processes marketplace_purchase.purchased and updates customer tier in postgres mode", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockExecutor = {
      query: vi.fn(),
      close: mockClose,
    };
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue(mockExecutor as never);

    const recordEventSpy = vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "ev_1",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "del-marketplace-123",
        tenantId: "octo-org",
        type: "marketplace_purchase.purchased",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const applyPurchaseSpy = vi.spyOn(dbModule.BillingStore.prototype, "applyMarketplacePurchase").mockResolvedValue({
      id: "cust_1",
      tenantId: "octo-org",
      stripeCustomerId: null,
      tier: "free",
      status: "active",
      trialEndsAt: null,
      graceEndsAt: null,
      currentPeriodEnd: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const markProcessedSpy = vi
      .spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed")
      .mockResolvedValue(undefined);

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("purchased"));
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "purchased",
      tier: "free",
    });

    expect(recordEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "del-marketplace-123",
        action: "purchased",
        tenantId: "octo-org",
      }),
    );
    expect(applyPurchaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "octo-org",
        tier: "free",
        status: "active",
      }),
    );
    expect(markProcessedSpy).toHaveBeenCalledWith("del-marketplace-123");
    expect(mockClose).toHaveBeenCalled();
  });

  it("handles duplicate delivery idempotently without re-applying state", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: false,
      event: null,
    });

    const applyPurchaseSpy = vi.spyOn(dbModule.BillingStore.prototype, "applyMarketplacePurchase");

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("purchased"));
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
      delivery: "del-marketplace-123",
    });
    expect(applyPurchaseSpy).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("processes marketplace_purchase.cancelled by setting tier to free", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "ev_cancel",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "del-marketplace-123",
        tenantId: "octo-org",
        type: "marketplace_purchase.cancelled",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const cancelSpy = vi.spyOn(dbModule.BillingStore.prototype, "applyMarketplaceCancellation").mockResolvedValue(null);
    const markProcessedSpy = vi
      .spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed")
      .mockResolvedValue(undefined);

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("cancelled"));
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "cancelled",
      tier: "free",
    });
    expect(cancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "octo-org",
      }),
    );
    expect(markProcessedSpy).toHaveBeenCalledWith("del-marketplace-123");
  });

  it("processes marketplace_purchase.changed and updates plan", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "ev_changed",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "del-marketplace-123",
        tenantId: "octo-org",
        type: "marketplace_purchase.changed",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const applyPurchaseSpy = vi.spyOn(dbModule.BillingStore.prototype, "applyMarketplacePurchase").mockResolvedValue({
      id: "cust_1",
      tenantId: "octo-org",
      stripeCustomerId: null,
      tier: "free",
      status: "active",
      trialEndsAt: null,
      graceEndsAt: null,
      currentPeriodEnd: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const markProcessedSpy = vi
      .spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed")
      .mockResolvedValue(undefined);

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("changed"));
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "changed",
      tier: "free",
    });
    expect(applyPurchaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "octo-org",
        tier: "free",
      }),
    );
    expect(markProcessedSpy).toHaveBeenCalledWith("del-marketplace-123");
  });

  it("handles pending_change and pending_change_cancelled as safe acknowledged events", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "ev_pending",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "del-marketplace-123",
        tenantId: "octo-org",
        type: "marketplace_purchase.pending_change",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const markProcessedSpy = vi
      .spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed")
      .mockResolvedValue(undefined);

    const request = signedMarketplaceRequest(
      "marketplace_purchase",
      sampleMarketplacePurchasePayload("pending_change"),
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      action: "pending_change",
      pending: true,
    });
    expect(markProcessedSpy).toHaveBeenCalledWith("del-marketplace-123");
  });

  it("safely handles unknown action under marketplace_purchase", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "ev_unknown_action",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "del-marketplace-123",
        tenantId: "octo-org",
        type: "marketplace_purchase.custom_action",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const markProcessedSpy = vi
      .spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed")
      .mockResolvedValue(undefined);

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload("custom_action"));
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: "unsupported_action",
      action: "custom_action",
    });
    expect(markProcessedSpy).toHaveBeenCalledWith("del-marketplace-123");
  });

  it("returns 503 when database persistence fails", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close: mockClose } as never);

    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockRejectedValue(
      new Error("connection terminated"),
    );

    const request = signedMarketplaceRequest("marketplace_purchase", sampleMarketplacePurchasePayload());
    const response = await POST(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Marketplace webhook could not be durably accepted",
    });
    expect(mockClose).toHaveBeenCalled();
  });
});
