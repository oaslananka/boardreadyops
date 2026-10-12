import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processStripeEntitlementPass } from "../../apps/web/lib/stripe-entitlement-worker.js";
import { BillingStore } from "../../packages/db/src/billing-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const url = getPostgresTestConnectionString();
const describeDb = url ? describe : describe.skip;
const db = url ? createPgQueryExecutor({ connectionString: url, max: 4 }) : undefined;
const other = url ? createPgQueryExecutor({ connectionString: url, max: 2 }) : undefined;
const suffix = randomUUID().slice(0, 8);
const tenant = `stripe-transaction-${suffix}`;
const customer = `cus_transaction_${suffix}`;
const ids: string[] = [];
const oldPrices = [
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
].map((key) => [key, process.env[key]] as const);

function database() {
  if (!db) throw new Error("DATABASE_URL required");
  return db;
}
function rows(result: unknown): Array<Record<string, unknown>> {
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}
async function enqueue(name: string, type: string, object: Record<string, unknown>, created: number) {
  const id = `evt_${name}_${suffix}`;
  ids.push(id);
  await new BillingStore(database()).recordEvent({
    stripeEventId: id,
    type,
    payload: { id, type, created, data: { object } },
  });
  return id;
}
async function row(id: string) {
  return rows(
    await database().query(
      "SELECT processed_at, dead_letter_at, available_at, attempts FROM billing_events WHERE stripe_event_id=$1",
      [id],
    ),
  )[0];
}
function subscription() {
  return {
    id: `sub_${suffix}`,
    customer,
    status: "active",
    quantity: 1,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_team_month" } }] },
  };
}
beforeAll(async () => {
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
});
afterAll(async () => {
  if (db) {
    await db.query("DELETE FROM billing_events WHERE stripe_event_id = ANY($1::text[])", [ids]);
    await db.query("DELETE FROM billing_subscriptions WHERE tenant_id=$1", [tenant]);
    await db.query("DELETE FROM billing_customers WHERE tenant_id=$1", [tenant]);
    await db.close();
  }
  if (other) await other.close();
  for (const [key, value] of oldPrices) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describeDb("Stripe transactional reconciliation: PostgreSQL", () => {
  it("defers a subscription, links checkout and resumes the pending event", async () => {
    const sub = await enqueue("early_subscription", "customer.subscription.created", subscription(), 1_700_000_100);
    expect(await processStripeEntitlementPass(database(), { limit: 1 })).toMatchObject({ deferred: 1 });
    expect((await row(sub))?.processed_at).toBeNull();
    const checkout = await enqueue(
      "checkout",
      "checkout.session.completed",
      {
        customer,
        client_reference_id: tenant,
      },
      1_700_000_200,
    );
    const processed = await processStripeEntitlementPass(database(), { limit: 2 });
    expect(processed.processed).toBe(2);
    expect((await row(sub))?.processed_at).not.toBeNull();
    expect((await row(checkout))?.processed_at).not.toBeNull();
    const customerRows = rows(
      await database().query("SELECT tier FROM billing_customers WHERE tenant_id=$1", [tenant]),
    );
    expect(customerRows[0]?.tier).toBe("team");
  });

  it("excludes already-locked rows across separate worker connections", async () => {
    const invoice = await enqueue("paid_once", "invoice.paid", { customer }, 1_700_000_400);
    let resume: (() => void) | undefined;
    let ready: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = database().withTransaction(async (tx) => {
      const records = rows(
        await tx.query("SELECT id FROM billing_events WHERE stripe_event_id=$1 FOR UPDATE", [invoice]),
      );
      expect(records).toHaveLength(1);
      ready?.();
      await gate;
    });
    await locked;
    const parallel = await processStripeEntitlementPass(other as NonNullable<typeof other>, { limit: 1 });
    expect(parallel.processed).toBe(0);
    resume?.();
    await held;
    expect((await row(invoice))?.processed_at).toBeNull();
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(invoice))?.processed_at).not.toBeNull();
  });

  it("defers a contended customer without deadlocking a checkout waking event rows", async () => {
    const candidate = await enqueue("contended_invoice", "invoice.paid", { customer }, 1_700_000_450);
    let release: (() => void) | undefined;
    let ready: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = database().withTransaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [customer]);
      ready?.();
      await held;
    });
    await started;
    expect((await processStripeEntitlementPass(other as NonNullable<typeof other>, { limit: 1 })).deferred).toBe(1);
    expect((await row(candidate))?.processed_at).toBeNull();
    release?.();
    await holder;
    await database().query("UPDATE billing_events SET available_at=NOW() WHERE stripe_event_id=$1", [candidate]);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
  });

  it("never replays an older failed invoice after a newer paid invoice", async () => {
    const newer = await enqueue("newer_paid", "invoice.paid", { customer }, 1_700_000_600);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const older = await enqueue("older_failed", "invoice.payment_failed", { customer }, 1_700_000_500);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(older))?.processed_at).not.toBeNull();
    const customerRows = rows(
      await database().query("SELECT status, last_invoice_event_created_at FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    );
    expect(customerRows[0]?.status).not.toBe("past_due");
    expect(new Date(String(customerRows[0]?.last_invoice_event_created_at)).toISOString()).toBe(
      new Date(1_700_000_600 * 1_000).toISOString(),
    );
    expect((await row(newer))?.processed_at).not.toBeNull();
  });

  it("retains a newer invoice failure even when an older subscription arrives later", async () => {
    const failed = await enqueue(
      "invoice_before_older_subscription",
      "invoice.payment_failed",
      { customer },
      1_700_000_900,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const older = await enqueue("older_subscription", "customer.subscription.updated", subscription(), 1_700_000_850);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const latest = rows(await database().query("SELECT status FROM billing_customers WHERE tenant_id=$1", [tenant]));
    expect(latest[0]?.status).toBe("past_due");
    expect((await row(failed))?.processed_at).not.toBeNull();
    expect((await row(older))?.processed_at).not.toBeNull();
  });

  it("rolls back a failed transaction then retries without marking processed", async () => {
    const failure = await enqueue("failed_then_retry", "invoice.payment_failed", { customer }, 1_700_001_200);
    await database().query(
      `CREATE OR REPLACE FUNCTION stripe_test_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'synthetic projection failure'; END; $$`,
    );
    await database().query(
      `CREATE TRIGGER stripe_test_projection_failure BEFORE UPDATE ON billing_customers
       FOR EACH ROW EXECUTE FUNCTION stripe_test_fail_${suffix}()`,
    );
    try {
      expect((await processStripeEntitlementPass(database(), { limit: 1 })).failed).toBe(1);
      const failed = await row(failure);
      expect(failed?.processed_at).toBeNull();
      expect(Number(failed?.attempts)).toBe(1);
    } finally {
      await database().query("DROP TRIGGER IF EXISTS stripe_test_projection_failure ON billing_customers");
      await database().query(`DROP FUNCTION IF EXISTS stripe_test_fail_${suffix}()`);
    }
    await database().query("UPDATE billing_events SET available_at=NOW() WHERE stripe_event_id=$1", [failure]);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(failure))?.processed_at).not.toBeNull();
  });

  it("quarantines a corrupt persisted event without mutating entitlements", async () => {
    const invalid = `evt_corrupt_${suffix}`;
    ids.push(invalid);
    await database().query(
      `INSERT INTO billing_events(id,stripe_event_id,type,payload)
       VALUES ($1,$2,'invoice.paid',$3::jsonb)`,
      [randomUUID(), invalid, JSON.stringify({ id: "tampered", type: "invoice.paid", created: 100 })],
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    const selected = await row(invalid);
    expect(selected?.processed_at).toBeNull();
    expect(selected?.dead_letter_at).not.toBeNull();
  });
});
