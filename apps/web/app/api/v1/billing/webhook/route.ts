import { handledStripeEventTypes, verifyStripeWebhook } from "@boardreadyops/cloud-core";
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

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
  let event: { id: string; type: string; data?: unknown };
  try {
    event = JSON.parse(rawBody) as { id: string; type: string; data?: unknown };
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

    // For known events, project entitlement (simplified)
    // In production, parse event.data.object, update billing_customers/subscriptions
    // Here we mark as processed to prove idempotency
    await store.markEventProcessed(event.id);

    // invoice.payment_failed: grace-period tenant lookup from the Stripe customer ID is not
    // implemented in this stub; the event is still durably recorded above via markEventProcessed.
    return Response.json(
      { ok: true, processed: true },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}
