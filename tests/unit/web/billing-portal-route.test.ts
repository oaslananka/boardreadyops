import { describe, expect, it, vi } from "vitest";
import {
  handlePortalRequest,
  type PortalRouteDependencies,
} from "../../../apps/web/app/api/v1/billing/portal/route.js";

function baseDependencies(overrides: Partial<PortalRouteDependencies> = {}): PortalRouteDependencies {
  return {
    billingMode: () => "stripe",
    authorizeViewer: async () => ({ login: "octo-org" }),
    stripeSecretKey: () => "sk_test_123",
    databaseUrl: () => "postgresql://localhost/test",
    getExistingCustomer: async () => ({ stripeCustomerId: "cus_existing" }),
    createBillingClient: () => ({
      createCheckoutSession: vi.fn(),
      createBillingPortalSession: vi.fn().mockResolvedValue({ id: "bps_1", url: "https://billing.stripe.com/bps_1" }),
    }),
    appUrl: () => "https://app.example.com",
    retiredMarketplaceFreeResponse: async () =>
      Response.json({ ok: false, error: "marketplace_free_only", code: "marketplace_free_only" }, { status: 410 }),
    ...overrides,
  };
}

function jsonRequest(body: unknown = {}): Request {
  return new Request("https://boardreadyops.test/api/v1/billing/portal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/billing/portal", () => {
  it("delegates to the retired marketplace-free response when BILLING_MODE is marketplace_free (default)", async () => {
    const deps = baseDependencies({ billingMode: () => "marketplace_free" });
    const response = await handlePortalRequest(jsonRequest(), deps);
    expect(response.status).toBe(410);
  });

  it("requires authentication in stripe mode", async () => {
    const deps = baseDependencies({ authorizeViewer: async () => undefined });
    const response = await handlePortalRequest(jsonRequest(), deps);
    expect(response.status).toBe(401);
  });

  it("returns 409 when the tenant has no linked Stripe customer yet", async () => {
    const deps = baseDependencies({ getExistingCustomer: async () => null });
    const response = await handlePortalRequest(jsonRequest(), deps);
    expect(response.status).toBe(409);
  });

  it("returns 409 when the tenant record exists but was never linked to a Stripe customer", async () => {
    const deps = baseDependencies({ getExistingCustomer: async () => ({ stripeCustomerId: null }) });
    const response = await handlePortalRequest(jsonRequest(), deps);
    expect(response.status).toBe(409);
  });

  it("creates a billing portal session for the linked customer and returns its URL", async () => {
    const createBillingPortalSession = vi
      .fn()
      .mockResolvedValue({ id: "bps_1", url: "https://billing.stripe.com/bps_1" });
    const deps = baseDependencies({
      createBillingClient: () => ({ createCheckoutSession: vi.fn(), createBillingPortalSession }),
    });

    const response = await handlePortalRequest(jsonRequest(), deps);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; url: string };
    expect(body).toEqual({ ok: true, url: "https://billing.stripe.com/bps_1" });
    expect(createBillingPortalSession).toHaveBeenCalledWith({
      customerId: "cus_existing",
      returnUrl: "https://app.example.com/settings/billing",
    });
  });

  it("honors an explicit returnUrl from the request body", async () => {
    const createBillingPortalSession = vi
      .fn()
      .mockResolvedValue({ id: "bps_2", url: "https://billing.stripe.com/bps_2" });
    const deps = baseDependencies({
      createBillingClient: () => ({ createCheckoutSession: vi.fn(), createBillingPortalSession }),
    });

    await handlePortalRequest(
      jsonRequest({ returnUrl: "https://app.example.com/settings/billing?from=upgrade" }),
      deps,
    );

    expect(createBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: "https://app.example.com/settings/billing?from=upgrade" }),
    );
  });
});
