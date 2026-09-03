import {
  billingCustomerStatusFromStripeStatus,
  getStripePriceConfig,
  handledStripeEventTypes,
  parseStripeCheckoutSessionCompleted,
  parseStripeInvoiceEvent,
  parseStripeSubscriptionEvent,
  resolveIntervalFromPriceId,
  resolveTierFromPriceId,
  verifyStripeWebhook,
} from "@boardreadyops/cloud-core";
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

type StripeWebhookEvent = { id: string; type: string; created?: number; data?: { object?: unknown } };

async function projectCheckoutSessionCompleted(
  store: BillingStore,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const parsed = parseStripeCheckoutSessionCompleted(payload);
  if (!parsed) return { entitlement: "ignored", reason: "unrecognized_checkout_session_payload" };
  await store.linkStripeCustomer(parsed);
  return { entitlement: "linked", tenantId: parsed.tenantId };
}

/** Resolves the tier + billing interval a subscription event maps to, or why it can't. */
function resolveSubscriptionTier(
  stripePriceId: string,
  canceled: boolean,
): { tier: "free" | "team" | "business"; interval: "month" | "year" } | { ignoredReason: string } {
  if (canceled) return { tier: "free", interval: "month" };
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

  const canceled = eventType === "customer.subscription.deleted";
  const resolved = resolveSubscriptionTier(parsed.stripePriceId, canceled);
  if ("ignoredReason" in resolved) {
    return { entitlement: "ignored", reason: resolved.ignoredReason, stripePriceId: parsed.stripePriceId };
  }
  const customerStatus = canceled ? "canceled" : billingCustomerStatusFromStripeStatus(parsed.status);

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
  return result.applied
    ? { entitlement: "applied", tenantId: result.tenantId, tier: resolved.tier }
    : { entitlement: "deferred", reason: "customer_not_linked" };
}

async function projectInvoiceEvent(
  store: BillingStore,
  payload: unknown,
  onLinkedTenant: (tenantId: string) => Promise<void>,
  appliedEntitlement: string,
): Promise<Record<string, unknown>> {
  const parsed = parseStripeInvoiceEvent(payload);
  if (!parsed) return { entitlement: "ignored", reason: "unrecognized_invoice_payload" };
  const tenantId = await store.resolveTenantIdByStripeCustomerId(parsed.stripeCustomerId);
  if (!tenantId) return { entitlement: "deferred", reason: "customer_not_linked" };
  await onLinkedTenant(tenantId);
  return { entitlement: appliedEntitlement, tenantId };
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
async function projectEntitlement(store: BillingStore, event: StripeWebhookEvent): Promise<Record<string, unknown>> {
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
      return projectInvoiceEvent(
        store,
        payload,
        (tenantId) => store.applyGraceOnPaymentFailure(tenantId),
        "grace_applied",
      );

    case "invoice.paid":
      return projectInvoiceEvent(
        store,
        payload,
        (tenantId) => store.clearGraceOnPaymentSuccess(tenantId),
        "grace_cleared",
      );

    default:
      return {};
  }
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Without secret, we cannot verify; return 503 so Stripe retries, but still acknowledge unknown events as 2xx per spec
    return Response.json(
      { ok: false, error: "Webhook secret not configured" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  const verified = verifyStripeWebhook({
    payload: rawBody,
    secret: webhookSecret,
    signatureHeader,
    now: Math.floor(Date.now() / 1000),
  });
  if (!verified) {
    return Response.json(
      { ok: false, error: "Invalid signature" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (!event.id || !event.type) {
    return Response.json(
      { ok: false, error: "Missing event id/type" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    // Still return 2xx for unknown events per spec, but for known events we need DB
    return Response.json(
      { ok: true, received: true, mode: "no-db" },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new BillingStore(executor);
    const { inserted } = await store.recordEvent({ stripeEventId: event.id, type: event.type, payload: event });
    if (!inserted) {
      // Duplicate replay, idempotent success
      return Response.json(
        { ok: true, duplicate: true },
        { status: 200, headers: { "cache-control": "private, no-store" } },
      );
    }

    if (
      !handledStripeEventTypes.has(event.type as typeof handledStripeEventTypes extends Set<infer T> ? T : never) &&
      !(handledStripeEventTypes as unknown as Set<string>).has(event.type)
    ) {
      // Unknown event: audit and ignore with 2xx
      await store.markEventProcessed(event.id);
      return Response.json(
        { ok: true, ignored: true, reason: "unknown_event_type" },
        { status: 200, headers: { "cache-control": "private, no-store" } },
      );
    }

    const projection = await projectEntitlement(store, event);
    await store.markEventProcessed(event.id);

    return Response.json(
      { ok: true, processed: true, ...projection },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}
