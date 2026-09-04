import { describe, expect, it, vi } from "vitest";
import { createStripeBillingClient, type StripeSdkSubset } from "../../../apps/web/lib/stripe-billing-client.js";

function fakeSdk(
  overrides: { checkoutCreate?: ReturnType<typeof vi.fn>; portalCreate?: ReturnType<typeof vi.fn> } = {},
): {
  sdk: StripeSdkSubset;
  checkoutCreate: ReturnType<typeof vi.fn>;
  portalCreate: ReturnType<typeof vi.fn>;
} {
  const checkoutCreate = overrides.checkoutCreate ?? vi.fn();
  const portalCreate = overrides.portalCreate ?? vi.fn();
  return {
    sdk: {
      checkout: { sessions: { create: checkoutCreate } } as unknown as StripeSdkSubset["checkout"],
      billingPortal: { sessions: { create: portalCreate } } as unknown as StripeSdkSubset["billingPortal"],
    },
    checkoutCreate,
    portalCreate,
  };
}

describe("createStripeBillingClient", () => {
  it("creates a subscription-mode checkout session with the given price, customer and redirect URLs", async () => {
    const { sdk, checkoutCreate } = fakeSdk();
    checkoutCreate.mockResolvedValue({ id: "cs_123", url: "https://checkout.stripe.com/cs_123" });

    const client = createStripeBillingClient("sk_test_123", () => sdk);
    const result = await client.createCheckoutSession({
      customerId: "cus_1",
      clientReferenceId: "octo-org",
      priceId: "price_team_month",
      successUrl: "https://app.example.com/settings/billing?success=1",
      cancelUrl: "https://app.example.com/settings/billing?canceled=1",
    });

    expect(result).toEqual({ id: "cs_123", url: "https://checkout.stripe.com/cs_123" });
    expect(checkoutCreate).toHaveBeenCalledWith({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "octo-org",
      line_items: [{ price: "price_team_month", quantity: 1 }],
      success_url: "https://app.example.com/settings/billing?success=1",
      cancel_url: "https://app.example.com/settings/billing?canceled=1",
    });
  });

  it("omits the customer field for a first-time checkout with no linked Stripe customer yet", async () => {
    const { sdk, checkoutCreate } = fakeSdk();
    checkoutCreate.mockResolvedValue({ id: "cs_124", url: "https://checkout.stripe.com/cs_124" });

    const client = createStripeBillingClient("sk_test_123", () => sdk);
    await client.createCheckoutSession({
      clientReferenceId: "octo-org",
      priceId: "price_team_month",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    const call = checkoutCreate.mock.calls.at(-1)?.[0];
    expect(call).not.toHaveProperty("customer");
  });

  it("throws when Stripe returns a checkout session without a URL", async () => {
    const { sdk, checkoutCreate } = fakeSdk();
    checkoutCreate.mockResolvedValue({ id: "cs_125", url: null });

    const client = createStripeBillingClient("sk_test_123", () => sdk);
    await expect(
      client.createCheckoutSession({
        clientReferenceId: "octo-org",
        priceId: "price_team_month",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    ).rejects.toThrow("Stripe did not return a checkout session URL");
  });

  it("creates a billing portal session for an existing Stripe customer", async () => {
    const { sdk, portalCreate } = fakeSdk();
    portalCreate.mockResolvedValue({ id: "bps_1", url: "https://billing.stripe.com/bps_1" });

    const client = createStripeBillingClient("sk_test_123", () => sdk);
    const result = await client.createBillingPortalSession({
      customerId: "cus_1",
      returnUrl: "https://app.example.com/settings/billing",
    });

    expect(result).toEqual({ id: "bps_1", url: "https://billing.stripe.com/bps_1" });
    expect(portalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app.example.com/settings/billing",
    });
  });
});
