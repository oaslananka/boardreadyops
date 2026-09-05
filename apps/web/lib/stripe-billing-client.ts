import Stripe from "stripe";

interface StripeCheckoutSessionInput {
  customerId?: string | undefined;
  clientReferenceId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string> | undefined;
}

interface StripePortalSessionInput {
  customerId: string;
  returnUrl: string;
}

interface StripeBillingSession {
  id: string;
  url: string;
}

export interface StripeBillingClient {
  createCheckoutSession(input: StripeCheckoutSessionInput): Promise<StripeBillingSession>;
  createBillingPortalSession(input: StripePortalSessionInput): Promise<StripeBillingSession>;
}

/** The narrow slice of the Stripe SDK this client actually calls, so tests can inject a fake without mocking the "stripe" module. */
export interface StripeSdkSubset {
  checkout: { sessions: Pick<Stripe.Checkout.SessionResource, "create"> };
  billingPortal: { sessions: Pick<Stripe.BillingPortal.SessionResource, "create"> };
}

/**
 * Thin wrapper over the Stripe SDK: shapes this app's session-creation calls, nothing more. All
 * entitlement/tier logic stays in `@boardreadyops/cloud-core`'s stripe-service.ts, which is
 * deliberately free of live Stripe API calls -- this is the one place that makes them, kept at
 * the runtime edge (apps/web) rather than in the shared business-logic package.
 */
export function createStripeBillingClient(
  secretKey: string,
  createSdkClient: (key: string) => StripeSdkSubset = (key) => new Stripe(key),
): StripeBillingClient {
  const stripe = createSdkClient(secretKey);

  return {
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        ...(input.customerId ? { customer: input.customerId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        client_reference_id: input.clientReferenceId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) {
        throw new Error("Stripe did not return a checkout session URL");
      }
      return { id: session.id, url: session.url };
    },

    async createBillingPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { id: session.id, url: session.url };
    },
  };
}
