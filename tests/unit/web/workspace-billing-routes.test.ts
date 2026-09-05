import { describe, expect, it, vi } from "vitest";
import { handleCheckoutRequest } from "../../../apps/web/app/api/v1/billing/checkout/route.js";
import { handlePortalRequest } from "../../../apps/web/app/api/v1/billing/portal/route.js";
import type { StripeBillingClient } from "../../../apps/web/lib/stripe-billing-client.js";

describe("Workspace Billing Checkout Route", () => {
  const fakePriceConfig = {
    teamMonthlyPriceId: "price_team_mo",
    teamYearlyPriceId: "price_team_yr",
    businessMonthlyPriceId: "price_biz_mo",
    businessYearlyPriceId: "price_biz_yr",
  };

  it("passes workspaceId to checkout session metadata and clientReferenceId", async () => {
    let capturedSessionInput: unknown;
    const fakeClient: StripeBillingClient = {
      async createCheckoutSession(input) {
        capturedSessionInput = input;
        return { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" };
      },
      async createBillingPortalSession() {
        return { id: "bps_test", url: "https://billing.stripe.com/session" };
      },
    };

    const request = new Request("https://boardreadyops.com/api/v1/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "team",
        interval: "month",
        workspaceId: "ws_maker_01",
        successUrl: "https://boardreadyops.com/settings/billing?success=true",
        cancelUrl: "https://boardreadyops.com/settings/billing?canceled=true",
      }),
    });

    const response = await handleCheckoutRequest(request, {
      billingMode: () => "both",
      retiredMarketplaceFreeResponse: vi.fn(),
      authorizeViewer: async () => ({ login: "maker_user" }),
      priceConfig: () => fakePriceConfig,
      stripeSecretKey: () => "sk_test_123",
      databaseUrl: () => "postgres://localhost/test",
      getExistingCustomer: async () => null,
      createBillingClient: () => fakeClient,
      appUrl: () => "https://boardreadyops.com",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; url: string };
    expect(body.ok).toBe(true);
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_123");

    expect(capturedSessionInput).toEqual(
      expect.objectContaining({
        clientReferenceId: "ws_maker_01",
        metadata: expect.objectContaining({ workspace_id: "ws_maker_01" }),
      }),
    );
  });

  it("resolves customer for workspaceId in portal route", async () => {
    let queriedTenantId: string | undefined;
    const fakeClient: StripeBillingClient = {
      async createCheckoutSession() {
        return { id: "cs_test", url: "https://checkout.stripe.com" };
      },
      async createBillingPortalSession(input) {
        return { id: "bps_test", url: `https://billing.stripe.com/session?c=${input.customerId}` };
      },
    };

    const request = new Request("https://boardreadyops.com/api/v1/billing/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "ws_maker_01",
        returnUrl: "https://boardreadyops.com/settings/billing",
      }),
    });

    const response = await handlePortalRequest(request, {
      billingMode: () => "both",
      retiredMarketplaceFreeResponse: vi.fn(),
      authorizeViewer: async () => ({ login: "maker_user" }),
      stripeSecretKey: () => "sk_test_123",
      databaseUrl: () => "postgres://localhost/test",
      getExistingCustomer: async (tenantId) => {
        queriedTenantId = tenantId;
        return { stripeCustomerId: "cus_existing_123" };
      },
      createBillingClient: () => fakeClient,
      appUrl: () => "https://boardreadyops.com",
    });

    expect(response.status).toBe(200);
    expect(queriedTenantId).toBe("ws_maker_01");
  });
});
