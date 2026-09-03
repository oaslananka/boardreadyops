export interface StripePriceConfig {
  teamMonthlyPriceId: string;
  teamYearlyPriceId: string;
  businessMonthlyPriceId: string;
  businessYearlyPriceId: string;
}

export function getStripePriceConfig(): StripePriceConfig | null {
  const cfg = {
    teamMonthlyPriceId: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID ?? "",
    teamYearlyPriceId: process.env.STRIPE_TEAM_YEARLY_PRICE_ID ?? "",
    businessMonthlyPriceId: process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID ?? "",
    businessYearlyPriceId: process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID ?? "",
  };
  if (!cfg.teamMonthlyPriceId || !cfg.businessMonthlyPriceId) return null;
  return cfg;
}

export function resolveTierFromPriceId(priceId: string, config: StripePriceConfig): "team" | "business" | null {
  if (priceId === config.teamMonthlyPriceId || priceId === config.teamYearlyPriceId) return "team";
  if (priceId === config.businessMonthlyPriceId || priceId === config.businessYearlyPriceId) return "business";
  return null;
}

export function resolveIntervalFromPriceId(priceId: string, config: StripePriceConfig): "month" | "year" | null {
  if (priceId === config.teamMonthlyPriceId || priceId === config.businessMonthlyPriceId) return "month";
  if (priceId === config.teamYearlyPriceId || priceId === config.businessYearlyPriceId) return "year";
  return null;
}

export const handledStripeEventTypes = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * Subscription/customer/price -> entitlement projection.
 *
 * Parses the already-signature-verified webhook payload (no live Stripe API calls) into the
 * shapes the billing store needs, and maps Stripe's own subscription status vocabulary onto
 * this repo's `billing_customers.status` enum (active | trialing | past_due | canceled |
 * incomplete). Deliberately narrow: only the fields the projection uses are read, and every
 * reader tolerates a missing/malformed field by returning `undefined` rather than throwing --
 * a webhook handler must never 500 on a Stripe payload shape it doesn't fully recognise.
 */

export type BillingCustomerStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

/**
 * Maps a Stripe subscription `status` to this repo's billing_customers status enum.
 *
 * `unpaid` and `incomplete_expired` are Stripe's own end-states after retries are exhausted
 * without a successful charge -- both are treated as `canceled` here since neither leaves the
 * customer with anything to keep entitled. `paused` (collection paused, no invoices) is
 * conservatively treated the same way: fail safe to the least-privileged outcome for any
 * subscription status this projection does not explicitly recognise.
 */
export function billingCustomerStatusFromStripeStatus(status: string): BillingCustomerStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    default:
      return "canceled";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isoFromUnixSeconds(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value * 1000).toISOString();
}

export type StripeCheckoutSessionCompleted = {
  stripeCustomerId: string;
  /** `client_reference_id` set when the checkout session was created -- this repo's tenant id. */
  tenantId: string;
};

/**
 * Parses a `checkout.session.completed` event's `data.object`.
 *
 * This is the only event in the handled set that carries both a fresh Stripe customer id and
 * this repo's own tenant id (`client_reference_id`), so it is the sole place the two get
 * linked. Subscription events that arrive first (out of order, or replayed before this one is
 * processed) cannot be attributed to a tenant yet -- callers must treat that as a deferral, not
 * an error.
 */
export function parseStripeCheckoutSessionCompleted(data: unknown): StripeCheckoutSessionCompleted | undefined {
  const session = record(data);
  const stripeCustomerId = nonEmptyString(session?.customer);
  const tenantId = nonEmptyString(session?.client_reference_id);
  if (!stripeCustomerId || !tenantId) return undefined;
  return { stripeCustomerId, tenantId };
}

export type StripeSubscriptionEvent = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  /** Raw Stripe subscription status (trialing, active, past_due, canceled, unpaid, ...). */
  status: string;
  quantity: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | undefined;
};

/** Parses a `customer.subscription.*` event's `data.object`. */
export function parseStripeSubscriptionEvent(data: unknown): StripeSubscriptionEvent | undefined {
  const subscription = record(data);
  const stripeCustomerId = nonEmptyString(subscription?.customer);
  const stripeSubscriptionId = nonEmptyString(subscription?.id);
  const status = nonEmptyString(subscription?.status);
  const items = record(subscription?.items);
  const firstItem = Array.isArray(items?.data) ? record(items.data[0]) : undefined;
  const price = record(firstItem?.price);
  const stripePriceId = nonEmptyString(price?.id);
  const currentPeriodStart = isoFromUnixSeconds(subscription?.current_period_start);
  const currentPeriodEnd = isoFromUnixSeconds(subscription?.current_period_end);
  if (
    !stripeCustomerId ||
    !stripeSubscriptionId ||
    !status ||
    !stripePriceId ||
    !currentPeriodStart ||
    !currentPeriodEnd
  ) {
    return undefined;
  }
  const quantity = typeof subscription?.quantity === "number" && subscription.quantity > 0 ? subscription.quantity : 1;
  return {
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    status,
    quantity,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
    trialEndsAt: isoFromUnixSeconds(subscription?.trial_end),
  };
}

export type StripeInvoiceEvent = {
  stripeCustomerId: string;
};

/** Parses an `invoice.paid` / `invoice.payment_failed` event's `data.object`. */
export function parseStripeInvoiceEvent(data: unknown): StripeInvoiceEvent | undefined {
  const invoice = record(data);
  const stripeCustomerId = nonEmptyString(invoice?.customer);
  if (!stripeCustomerId) return undefined;
  return { stripeCustomerId };
}
