import { verifyStripeWebhook } from "@boardreadyops/cloud-core";
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "../../../../../lib/bounded-request-body.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const maximumStripeWebhookBytes = 1024 * 1024;
type StripeWebhookEvent = { id: string; type: string };

export async function POST(request: Request): Promise<Response> {
  const signatureHeader = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { ok: false, error: "Webhook secret not configured" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (!signatureHeader) {
    return Response.json(
      { ok: false, error: "Invalid signature" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  let rawBody: string;
  try {
    rawBody = (await readBoundedRequestBody(request, maximumStripeWebhookBytes)).toString("utf8");
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) throw error;
    return Response.json(
      { ok: false, error: "Stripe webhook payload is too large" },
      {
        status: 413,
        headers: { "cache-control": "private, no-store" },
      },
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
    // Fail closed: a 2xx without a durable event write would silently lose
    // customer entitlements. Stripe will retry after a non-2xx response.
    return Response.json(
      { ok: false, error: "Billing persistence unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new BillingStore(executor);
    // All event types are audited; the worker applies only recognized projections.
    // Uniqueness of Stripe event ids makes redelivery safe without request-time
    // entitlement mutations or an unbounded replay loop.
    const { inserted } = await store.recordEvent({ stripeEventId: event.id, type: event.type, payload: event });
    return Response.json(
      { ok: true, received: true, duplicate: !inserted },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    // Stripe must retry a signed event that could not be durably recorded.
    // Return a retryable status without exposing connection details or the event body.
    return Response.json(
      { ok: false, error: "Billing inbox temporarily unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}
