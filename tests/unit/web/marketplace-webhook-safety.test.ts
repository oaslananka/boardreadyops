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
let originalProcessMarketplaceEvent: PropertyDescriptor | undefined;

function payload(planName = "Community") {
  return {
    action: "purchased",
    effective_date: "2026-08-28T00:00:00Z",
    marketplace_purchase: {
      account: { id: 999, login: "octo-org", type: "Organization" },
      billing_cycle: "monthly",
      on_free_trial: false,
      plan: { id: 101, name: planName, price_model: "free" },
    },
  };
}

function signedRequest(bodyValue: unknown, delivery = "safety-delivery-1") {
  const body = JSON.stringify(bodyValue);
  const secret = "test-marketplace-secret";
  return new Request("https://boardreadyops.test/api/github/marketplace/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": delivery,
      "x-github-event": "marketplace_purchase",
      "x-hub-signature-256": createGitHubSignatureHeader(body, secret),
    },
    body,
  });
}

function mockFutureAtomicProcessor(result: unknown) {
  originalProcessMarketplaceEvent = Object.getOwnPropertyDescriptor(
    dbModule.BillingStore.prototype,
    "processMarketplaceEvent",
  );
  const fn = vi.fn().mockResolvedValue(result);
  Object.defineProperty(dbModule.BillingStore.prototype, "processMarketplaceEvent", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (originalProcessMarketplaceEvent) {
    Object.defineProperty(dbModule.BillingStore.prototype, "processMarketplaceEvent", originalProcessMarketplaceEvent);
  } else {
    delete (dbModule.BillingStore.prototype as unknown as Record<string, unknown>).processMarketplaceEvent;
  }
  originalProcessMarketplaceEvent = undefined;
  vi.restoreAllMocks();
});

describe("Marketplace webhook safety contract", () => {
  it("fails closed when durable postgres persistence is unavailable", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";

    const response = await POST(signedRequest(payload()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Marketplace persistence is not configured",
    });
  });

  it("keeps the Marketplace Community listing free even if a paid-looking plan name arrives", async () => {
    process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "test-marketplace-secret";
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
    delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query: vi.fn(), close } as never);
    const processEvent = mockFutureAtomicProcessor({ outcome: "applied", stateChanged: true });

    // Keep the legacy path executable during the RED phase. The desired implementation
    // must stop using these provider-coupled mutations.
    vi.spyOn(dbModule.BillingStore.prototype, "recordMarketplaceEvent").mockResolvedValue({
      inserted: true,
      event: {
        id: "legacy-event",
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: "safety-delivery-1",
        tenantId: "octo-org",
        type: "marketplace_purchase.purchased",
        payload: {},
        processedAt: null,
        createdAt: new Date().toISOString(),
      },
    });
    vi.spyOn(dbModule.BillingStore.prototype, "applyMarketplacePurchase").mockResolvedValue({
      id: "legacy-customer",
      tenantId: "octo-org",
      stripeCustomerId: null,
      tier: "team",
      status: "active",
      trialEndsAt: null,
      graceEndsAt: null,
      currentPeriodEnd: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(dbModule.BillingStore.prototype, "markMarketplaceEventProcessed").mockResolvedValue(undefined);

    const response = await POST(signedRequest(payload("Team Enterprise")));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      action: "purchased",
      tier: "free",
    });
    expect(processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "purchased",
        githubAccountId: 999,
        accountLogin: "octo-org",
        planTier: "free",
      }),
    );
  });
});
