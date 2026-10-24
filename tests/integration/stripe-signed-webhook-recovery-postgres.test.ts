import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as receiveWebhook } from "../../apps/web/app/api/v1/billing/webhook/route.js";
import { processStripeEntitlementPass } from "../../apps/web/lib/stripe-entitlement-worker.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

// Real HTTP-handler signature verification and PostgreSQL persistence, without
// Stripe network requests or a live merchant. Use a disposable database only.
const databaseUrl = getPostgresTestConnectionString();
const describeDb = databaseUrl ? describe : describe.skip;
const secret = "whsec_disposable_postgres_acceptance";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const tenant = `webhook-acceptance-${suffix}`;
const customer = `cus_webhook_${suffix}`;
const subscription = `sub_webhook_${suffix}`;
const ids: string[] = [];
const envNames = [
  "DATABASE_URL",
  "BOARDREADYOPS_PERSISTENCE_MODE",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
] as const;
const previousEnv = new Map(envNames.map((key) => [key, process.env[key]]));
let executor = databaseUrl ? createPgQueryExecutor({ connectionString: databaseUrl, max: 3 }) : undefined;

function disposableDatabaseUrl(): string {
  if (!databaseUrl) throw new Error("A disposable PostgreSQL database is required");
  return databaseUrl;
}

function db() {
  if (!executor) throw new Error("A disposable PostgreSQL database is required");
  return executor;
}

function event(name: string, type: string, object: Record<string, unknown>, created: number) {
  const id = `evt_webhook_${name}_${suffix}`;
  ids.push(id);
  return { id, type, created, data: { object } };
}

function signedRequest(payload: object, signingSecret = secret) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("http://127.0.0.1/api/v1/billing/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${hash}` },
    body,
  });
}

async function inbox(id: string) {
  const result = (await db().query(
    `SELECT processed_at, dead_letter_at, last_error_class, attempts FROM billing_events WHERE stripe_event_id=$1`,
    [id],
  )) as {
    rows?: Array<{ processed_at: unknown; dead_letter_at: unknown; last_error_class: string | null; attempts: number }>;
  };
  return result.rows?.[0] as
    | { processed_at: unknown; dead_letter_at: unknown; last_error_class: string | null; attempts: number }
    | undefined;
}

beforeAll(() => {
  if (!databaseUrl) return;
  process.env.DATABASE_URL = databaseUrl;
  process.env.BOARDREADYOPS_PERSISTENCE_MODE = "postgres";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_webhook_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_webhook_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_webhook_business_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_webhook_business_year";
});

afterAll(async () => {
  try {
    if (executor) {
      await db().query("DELETE FROM billing_events WHERE stripe_event_id = ANY($1::text[])", [ids]);
      await db().query("DELETE FROM billing_subscriptions WHERE tenant_id=$1", [tenant]);
      await db().query("DELETE FROM billing_customers WHERE tenant_id=$1", [tenant]);
      await executor.close();
    }
  } finally {
    for (const name of envNames) {
      const original = previousEnv.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
});

describeDb("signed Stripe HTTP inbox to restarted PostgreSQL worker", () => {
  it("accepts signed, deduplicated, out-of-order events and resumes after worker restart", async () => {
    const created = Math.floor(Date.now() / 1000) - 90;
    const sub = event(
      "before_checkout",
      "customer.subscription.created",
      {
        id: subscription,
        customer,
        status: "active",
        quantity: 1,
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_webhook_team_month" } }] },
      },
      created,
    );

    expect((await receiveWebhook(signedRequest(sub, "incorrect_secret"))).status).toBe(400);
    expect(await inbox(sub.id)).toBeUndefined();

    const acknowledged = await receiveWebhook(signedRequest(sub));
    expect(acknowledged.status).toBe(200);
    expect(await acknowledged.json()).toMatchObject({ received: true, duplicate: false });
    const redelivered = await receiveWebhook(signedRequest(sub));
    expect(await redelivered.json()).toMatchObject({ received: true, duplicate: true });
    expect((await inbox(sub.id))?.processed_at).toBeNull();

    expect(await processStripeEntitlementPass(db(), { limit: 1 })).toMatchObject({ deferred: 1 });
    expect((await inbox(sub.id))?.last_error_class).toBe("customer_not_linked");

    // Emulate a worker process stopping while the deferred inbox row is durable.
    await db().close();
    executor = createPgQueryExecutor({ connectionString: disposableDatabaseUrl(), max: 3 });

    const checkout = event(
      "checkout",
      "checkout.session.completed",
      { customer, client_reference_id: tenant },
      created + 1,
    );
    expect((await receiveWebhook(signedRequest(checkout))).status).toBe(200);
    expect(await processStripeEntitlementPass(db(), { limit: 3 })).toMatchObject({ processed: 2 });
    expect((await inbox(sub.id))?.processed_at).not.toBeNull();
    expect((await inbox(checkout.id))?.processed_at).not.toBeNull();
    const customerResult = (await db().query("SELECT tier, status FROM billing_customers WHERE tenant_id=$1", [
      tenant,
    ])) as {
      rows?: Array<{ tier: string; status: string }>;
    };
    expect(customerResult.rows?.[0]).toMatchObject({ tier: "team", status: "active" });

    // A paid invoice for a different subscription must be quarantined, not grant access.
    const foreign = event(
      "foreign_invoice",
      "invoice.paid",
      {
        customer,
        parent: { subscription_details: { subscription: `sub_foreign_${suffix}` } },
      },
      created + 2,
    );
    expect((await receiveWebhook(signedRequest(foreign))).status).toBe(200);
    expect(await processStripeEntitlementPass(db(), { limit: 1 })).toMatchObject({ dead_letter: 1 });
    expect((await inbox(foreign.id))?.last_error_class).toBe("ambiguous_invoice_subscription");
    expect((await inbox(foreign.id))?.processed_at).toBeNull();

    // Failed DB writes must return a retryable non-2xx. Retrying the *same* signed
    // event after recovery must create exactly one durable row.
    const paid = event(
      "retry_after_outage",
      "invoice.paid",
      {
        customer,
        parent: { subscription_details: { subscription } },
      },
      created + 3,
    );
    process.env.DATABASE_URL = "postgresql://boardreadyops@127.0.0.1:1/unreachable";
    try {
      const failed = await receiveWebhook(signedRequest(paid));
      expect(failed.status).toBe(503);
    } finally {
      process.env.DATABASE_URL = disposableDatabaseUrl();
    }
    expect(await inbox(paid.id)).toBeUndefined();
    expect((await receiveWebhook(signedRequest(paid))).status).toBe(200);
    expect(await processStripeEntitlementPass(db(), { limit: 1 })).toMatchObject({ processed: 1 });
    expect((await inbox(paid.id))?.processed_at).not.toBeNull();
    expect((await receiveWebhook(signedRequest(paid))).status).toBe(200);
    const result = (await db().query("SELECT count(*)::integer AS count FROM billing_events WHERE stripe_event_id=$1", [
      paid.id,
    ])) as { rows?: Array<{ count: number }> };
    expect(result.rows?.[0]?.count).toBe(1);
    expect((await inbox(foreign.id))?.dead_letter_at).not.toBeNull();
  });
});
