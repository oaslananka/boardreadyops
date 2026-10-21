import {
  billingCustomerStatusFromStripeStatus,
  getStripePriceConfig,
  parseStripeCheckoutSessionCompleted,
  parseStripeInvoiceEvent,
  parseStripeSubscriptionEvent,
  resolveIntervalFromPriceId,
  resolveTierFromPriceId,
} from "@boardreadyops/cloud-core";
import type { BillingStore } from "@boardreadyops/db";

export type StripeWebhookEvent = { id: string; type: string; created?: number; data?: { object?: unknown } };

export function storedStripeEvent(value: unknown): StripeWebhookEvent | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (typeof event.id !== "string" || !event.id || typeof event.type !== "string" || !event.type) return undefined;
  return value as StripeWebhookEvent;
}

async function projectCheckoutSessionCompleted(
  store: BillingStore,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const parsed = parseStripeCheckoutSessionCompleted(payload);
  if (!parsed) return { entitlement: "ignored", reason: "unrecognized_checkout_session_payload" };
  const linked = await store.linkStripeCustomer(parsed);
  if (!linked) {
    // A signed checkout is not proof that a prior customer-to-tenant binding
    // may be changed. Fail closed until provider-state review resolves it.
    return { entitlement: "conflict", reason: "ambiguous_customer_linkage", tenantId: parsed.tenantId };
  }
  // Do not project pending events in the Stripe request thread. They are released
  // for bounded, transactional reconciliation by the existing cloud worker.
  await store.wakePendingStripeCustomerEvents(parsed.stripeCustomerId);
  return { entitlement: "linked", tenantId: parsed.tenantId };
}

/** Resolves the tier + billing interval a subscription event maps to, or why it can't. */
function resolveSubscriptionTier(
  stripePriceId: string,
  noPaidEntitlement: boolean,
): { tier: "free" | "team" | "business"; interval: "month" | "year" } | { ignoredReason: string } {
  if (noPaidEntitlement) return { tier: "free", interval: "month" };
  const priceConfig = getStripePriceConfig();
  const tier = priceConfig ? resolveTierFromPriceId(stripePriceId, priceConfig) : null;
  if (!priceConfig || !tier) {
    // Unmapped price id: STRIPE_*_PRICE_ID env config does not (yet) cover this price, or is
    // not configured at all. Safer to no-op than to guess a tier from an unknown price.
    return { ignoredReason: priceConfig ? "unmapped_stripe_price" : "stripe_price_config_missing" };
  }
  return { tier, interval: resolveIntervalFromPriceId(stripePriceId, priceConfig) ?? "month" };
}

async function projectSubscriptionEvent(
  store: BillingStore,
  eventType: string,
  eventCreatedAt: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const parsed = parseStripeSubscriptionEvent(payload);
  if (!parsed) return { entitlement: "ignored", reason: "unrecognized_subscription_payload" };

  const customerStatus =
    eventType === "customer.subscription.deleted" ? "canceled" : billingCustomerStatusFromStripeStatus(parsed.status);
  // Only active, trialing or grace-eligible past_due subscriptions have a paid plan.
  // Incomplete, canceled and unknown statuses fail closed regardless of webhook type.
  const paidEligible = customerStatus === "active" || customerStatus === "trialing" || customerStatus === "past_due";
  const resolved = resolveSubscriptionTier(parsed.stripePriceId, !paidEligible);
  if ("ignoredReason" in resolved) {
    // Missing configuration can be repaired later; never terminalize this event.
    return { entitlement: "deferred", reason: resolved.ignoredReason, stripePriceId: parsed.stripePriceId };
  }
  const result = await store.applyStripeSubscriptionEvent({
    stripeCustomerId: parsed.stripeCustomerId,
    stripeSubscriptionId: parsed.stripeSubscriptionId,
    stripePriceId: parsed.stripePriceId,
    tier: resolved.tier,
    interval: resolved.interval,
    status: parsed.status,
    customerStatus,
    quantity: parsed.quantity,
    currentPeriodStart: parsed.currentPeriodStart,
    currentPeriodEnd: parsed.currentPeriodEnd,
    cancelAtPeriodEnd: parsed.cancelAtPeriodEnd,
    trialEndsAt: parsed.trialEndsAt ?? null,
    eventCreatedAt,
  });
  if (result.applied) return { entitlement: "applied", tenantId: result.tenantId, tier: resolved.tier };
  if (result.conflict) {
    return {
      entitlement: "conflict",
      reason: result.conflictReason ?? "ambiguous_subscription_order",
      tenantId: result.tenantId,
    };
  }
  return result.tenantId
    ? { entitlement: "ignored", reason: "stale_subscription_event" }
    : { entitlement: "deferred", reason: "customer_not_linked" };
}

async function projectInvoiceEvent(
  store: BillingStore,
  payload: unknown,
  eventCreatedAt: string,
  outcome: "paid" | "failed",
): Promise<Record<string, unknown>> {
  const parsed = parseStripeInvoiceEvent(payload);
  if (!parsed) return { entitlement: "ignored", reason: "unrecognized_invoice_payload" };
  const tenantId = await store.resolveTenantIdByStripeCustomerId(parsed.stripeCustomerId);
  if (!tenantId) return { entitlement: "deferred", reason: "customer_not_linked" };
  const outcomeResult = await store.applyStripeInvoiceEvent({ tenantId, eventCreatedAt, outcome });
  if (outcomeResult === "applied") {
    return { entitlement: outcome === "paid" ? "grace_cleared" : "grace_applied", tenantId };
  }
  if (outcomeResult === "conflict") {
    return { entitlement: "conflict", reason: "ambiguous_invoice_order", tenantId };
  }
  if (outcomeResult === "missing_customer") {
    return { entitlement: "deferred", reason: "customer_not_found", tenantId };
  }
  return { entitlement: "ignored", reason: "stale_invoice_event", tenantId };
}

/**
 * Subscription/customer/price -> entitlement projection for a single verified Stripe event.
 *
 * Only interprets the already-verified payload already in hand -- no live Stripe API calls.
 * Every branch is defensive: a payload shape this projection does not recognise, or a Stripe
 * customer id not yet linked to a tenant (`checkout.session.completed` has not landed yet,
 * possibly because it is still in flight or arrived out of order), returns a descriptive
 * `entitlement` outcome rather than throwing. The event is durably recorded by `recordEvent`
 * before this runs either way, so a deferred projection is not a lost one.
 */
export async function projectEntitlement(
  store: BillingStore,
  event: StripeWebhookEvent,
): Promise<Record<string, unknown>> {
  const eventCreatedAt =
    typeof event.created === "number" ? new Date(event.created * 1000).toISOString() : new Date().toISOString();
  const payload = event.data?.object;

  switch (event.type) {
    case "checkout.session.completed":
      return projectCheckoutSessionCompleted(store, payload);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return projectSubscriptionEvent(store, event.type, eventCreatedAt, payload);

    case "invoice.payment_failed":
      return projectInvoiceEvent(store, payload, eventCreatedAt, "failed");

    case "invoice.paid":
      return projectInvoiceEvent(store, payload, eventCreatedAt, "paid");

    default:
      return {};
  }
}
