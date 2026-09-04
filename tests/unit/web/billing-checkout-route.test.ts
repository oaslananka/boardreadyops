import { describe, expect, it, vi } from "vitest";
import {
  type CheckoutRouteDependencies,
  handleCheckoutRequest,
} from "../../../apps/web/app/api/v1/billing/checkout/route.js";

const priceConfig = {
  teamMonthlyPriceId: "price_team_month",
  teamYearlyPriceId: "price_team_year",
  businessMonthlyPriceId: "price_biz_month",
  businessYearlyPriceId: "price_biz_year",
};

function baseDependencies(overrides: Partial<CheckoutRouteDependencies> = {}): CheckoutRouteDependencies {
  return {
    billingMode: () => "stripe",
    authorizeViewer: async () => ({ login: "octo-org" }),
    priceConfig: () => priceConfig,
    stripeSecretKey: () => "sk_test_123",
    databaseUrl: () => "postgresql://localhost/test",
    getExistingCustomer: async () => null,
    createBillingClient: () => ({
      createCheckoutSession: vi.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }),
      createBillingPortalSession: vi.fn(),
    }),
    appUrl: () => "https://app.example.com",
    retiredMarketplaceFreeResponse: async () =>
      Response.json({ ok: false, error: "marketplace_free_only", code: "marketplace_free_only" }, { status: 410 }),
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("https://boardreadyops.test/api/v1/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/billing/checkout", () => {
  it("delegates to the retired marketplace-free response when BILLING_MODE is marketplace_free (default)", async () => {
    const deps = baseDependencies({ billingMode: () => "marketplace_free" });
    const response = await handleCheckoutRequest(jsonRequest({ tier: "team" }), deps);
    expect(response.status).toBe(410);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("marketplace_free_only");
  });

  it("requires authentication in stripe mode", async () => {
    const deps = baseDependencies({ authorizeViewer: async () => undefined });
    const response = await handleCheckoutRequest(jsonRequest({ tier: "team" }), deps);
    expect(response.status).toBe(401);
  });

  it("rejects an invalid checkout request body", async () => {
    const deps = baseDependencies();
    const response = await handleCheckoutRequest(jsonRequest({ tier: "not-a-real-tier" }), deps);
    expect(response.status).toBe(400);
  });

  it("returns 503 when Stripe price configuration is missing", async () => {
    const deps = baseDependencies({ priceConfig: () => null });
    const response = await handleCheckoutRequest(jsonRequest({ tier: "team" }), deps);
    expect(response.status).toBe(503);
  });

  it("creates a checkout session for the resolved price and returns its URL", async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" });
    const deps = baseDependencies({
      createBillingClient: () => ({
        createCheckoutSession,
        createBillingPortalSession: vi.fn(),
      }),
    });

    const response = await handleCheckoutRequest(jsonRequest({ tier: "business", interval: "year" }), deps);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; url: string };
    expect(body).toEqual({ ok: true, url: "https://checkout.stripe.com/cs_1" });
    expect(createCheckoutSession).toHaveBeenCalledWith({
      clientReferenceId: "octo-org",
      priceId: "price_biz_year",
      successUrl: "https://app.example.com/settings/billing?checkout=success",
      cancelUrl: "https://app.example.com/settings/billing?checkout=canceled",
    });
  });

  it("passes the existing Stripe customer id when the tenant already has one linked", async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ id: "cs_2", url: "https://checkout.stripe.com/cs_2" });
    const deps = baseDependencies({
      getExistingCustomer: async () => ({ stripeCustomerId: "cus_existing" }),
      createBillingClient: () => ({ createCheckoutSession, createBillingPortalSession: vi.fn() }),
    });

    await handleCheckoutRequest(jsonRequest({ tier: "team" }), deps);

    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_existing" }));
  });
});
