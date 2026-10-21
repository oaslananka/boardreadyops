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
      "SELECT processed_at, dead_letter_at, available_at, attempts, last_error_class FROM billing_events WHERE stripe_event_id=$1",
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
    expect((await row(sub))?.attempts).toBe(1);
    expect((await row(sub))?.processed_at).toBeNull();
    // Simulate the final deferred retry without waiting hours for backoff.
    await database().query("UPDATE billing_events SET attempts=11, available_at=NOW() WHERE stripe_event_id=$1", [sub]);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(sub))?.last_error_class).toBe("customer_not_linked");
    expect((await row(sub))?.attempts).toBe(12);
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
    expect((await row(sub))?.attempts).toBe(0);
    expect((await row(sub))?.dead_letter_at).toBeNull();
    expect((await row(checkout))?.processed_at).not.toBeNull();
    const customerRows = rows(
      await database().query("SELECT tier FROM billing_customers WHERE tenant_id=$1", [tenant]),
    );
    expect(customerRows[0]?.tier).toBe("team");
  });

  it("quarantines checkout rebinds without changing the existing tenant or giving another tenant the customer", async () => {
    const store = new BillingStore(database());
    const before = rows(
      await database().query("SELECT stripe_customer_id, tier, status FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    )[0];
    expect(before?.stripe_customer_id).toBe(customer);

    const unexpectedCustomer = `cus_rebinding_${suffix}`;
    const rebind = await enqueue(
      "checkout_wrong_customer",
      "checkout.session.completed",
      { customer: unexpectedCustomer, client_reference_id: tenant },
      1_700_000_205,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(rebind))?.last_error_class).toBe("ambiguous_customer_linkage");
    expect((await row(rebind))?.processed_at).toBeNull();
    const after = rows(
      await database().query("SELECT stripe_customer_id, tier, status FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    )[0];
    expect(after).toEqual(before);
    expect(
      rows(
        await database().query("SELECT id FROM billing_customers WHERE stripe_customer_id=$1", [unexpectedCustomer]),
      ),
    ).toHaveLength(0);

    const unrelatedTenant = `stripe-other-tenant-${suffix}`;
    const hijack = await enqueue(
      "checkout_foreign_tenant",
      "checkout.session.completed",
      { customer, client_reference_id: unrelatedTenant },
      1_700_000_206,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(hijack))?.last_error_class).toBe("ambiguous_customer_linkage");
    expect(
      rows(await database().query("SELECT id FROM billing_customers WHERE tenant_id=$1", [unrelatedTenant])),
    ).toHaveLength(0);
    expect(
      rows(await database().query("SELECT stripe_customer_id FROM billing_customers WHERE tenant_id=$1", [tenant]))[0]
        ?.stripe_customer_id,
    ).toBe(customer);

    // Idempotent delivery for the original pairing remains accepted.
    await expect(store.linkStripeCustomer({ tenantId: tenant, stripeCustomerId: customer })).resolves.toMatchObject({
      tenantId: tenant,
      stripeCustomerId: customer,
      tier: "team",
    });
  });

  it("quarantines repeatably unmapped prices without starving later ready invoice events", async () => {
    const unmapped = await enqueue(
      "unmapped_price",
      "customer.subscription.updated",
      { ...subscription(), items: { data: [{ price: { id: "unmapped_price" } }] } },
      1_700_000_210,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).deferred).toBe(1);
    expect((await row(unmapped))?.last_error_class).toBe("unmapped_stripe_price");
    await database().query("UPDATE billing_events SET attempts=11, available_at=NOW() WHERE stripe_event_id=$1", [
      unmapped,
    ]);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(unmapped))?.dead_letter_at).not.toBeNull();
    expect((await row(unmapped))?.attempts).toBe(12);

    const ready = await enqueue("ready_after_unmapped", "invoice.paid", { customer }, 1_700_000_220);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(ready))?.processed_at).not.toBeNull();
    expect((await row(unmapped))?.processed_at).toBeNull();
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

  it("quarantines same-second paid after failed instead of silently acknowledging a conflicting state", async () => {
    const failed = await enqueue("equal_time_failed", "invoice.payment_failed", { customer }, 1_700_001_000);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const paid = await enqueue("equal_time_paid", "invoice.paid", { customer }, 1_700_001_000);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(paid))?.processed_at).toBeNull();
    expect((await row(paid))?.last_error_class).toBe("ambiguous_invoice_order");
    expect((await row(paid))?.dead_letter_at).not.toBeNull();
    const customerRows = rows(
      await database().query("SELECT status, last_invoice_event_outcome FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    );
    expect(customerRows[0]).toMatchObject({ status: "past_due", last_invoice_event_outcome: "failed" });
    expect((await row(failed))?.processed_at).not.toBeNull();
  });

  it("quarantines same-second failed after paid without revoking paid status", async () => {
    const paid = await enqueue("equal_time_paid_first", "invoice.paid", { customer }, 1_700_001_100);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const failed = await enqueue("equal_time_failed_second", "invoice.payment_failed", { customer }, 1_700_001_100);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(failed))?.processed_at).toBeNull();
    expect((await row(failed))?.last_error_class).toBe("ambiguous_invoice_order");
    const customerRows = rows(
      await database().query("SELECT status, last_invoice_event_outcome FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    );
    expect(customerRows[0]).toMatchObject({ status: "active", last_invoice_event_outcome: "paid" });
    expect((await row(paid))?.processed_at).not.toBeNull();
  });

  it("quarantines contradictory same-second subscription updates without changing an entitlement", async () => {
    const fresh = await enqueue(
      "subscription_same_second_first",
      "customer.subscription.updated",
      subscription(),
      1_700_003_000,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const before = rows(
      await database().query(
        "SELECT tier, status, last_event_created_at FROM billing_subscriptions WHERE stripe_subscription_id=$1",
        [subscription().id],
      ),
    )[0];
    expect(before).toMatchObject({ tier: "team", status: "active" });

    const contrary = await enqueue(
      "subscription_same_second_cancel",
      "customer.subscription.deleted",
      { ...subscription(), status: "canceled" },
      1_700_003_000,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(contrary))?.last_error_class).toBe("ambiguous_subscription_order");
    expect((await row(contrary))?.processed_at).toBeNull();
    const after = rows(
      await database().query(
        "SELECT tier, status, last_event_created_at FROM billing_subscriptions WHERE stripe_subscription_id=$1",
        [subscription().id],
      ),
    )[0];
    expect(after).toEqual(before);
    const customerRows = rows(
      await database().query("SELECT tier FROM billing_customers WHERE tenant_id=$1", [tenant]),
    );
    expect(customerRows[0]?.tier).toBe("team");
    expect((await row(fresh))?.processed_at).not.toBeNull();

    const old = await enqueue(
      "subscription_stale_after_conflict",
      "customer.subscription.deleted",
      { ...subscription(), status: "canceled" },
      1_700_002_999,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(old))?.dead_letter_at).toBeNull();
    const afterOld = rows(
      await database().query("SELECT tier, status FROM billing_subscriptions WHERE stripe_subscription_id=$1", [
        subscription().id,
      ]),
    )[0];
    expect(afterOld).toMatchObject({ tier: "team", status: "active" });
  });

  it("quarantines a second active subscription without overwriting the customer's plan", async () => {
    const first = rows(await database().query("SELECT tier FROM billing_customers WHERE tenant_id=$1", [tenant]))[0];
    expect(first?.tier).toBe("team");

    const additional = await enqueue(
      "parallel_business_subscription",
      "customer.subscription.created",
      {
        ...subscription(),
        id: `sub_additional_${suffix}`,
        status: "trialing",
        // Current Stripe API response shape (verified in test-mode sandbox):
        // periods are on the subscription item, not the subscription root.
        current_period_start: undefined,
        current_period_end: undefined,
        quantity: undefined,
        items: {
          data: [
            {
              price: { id: "price_business_month" },
              quantity: 1,
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      },
      1_700_003_100,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    expect((await row(additional))?.last_error_class).toBe("ambiguous_multi_subscription");
    expect((await row(additional))?.processed_at).toBeNull();
    expect(
      rows(await database().query("SELECT tier FROM billing_customers WHERE tenant_id=$1", [tenant]))[0]?.tier,
    ).toBe("team");
    expect(
      rows(
        await database().query("SELECT id FROM billing_subscriptions WHERE stripe_subscription_id=$1", [
          `sub_additional_${suffix}`,
        ]),
      ),
    ).toHaveLength(0);
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

  it("quarantines an event with a mismatched stored type before mutating a customer", async () => {
    const invalid = `evt_type_mismatch_${suffix}`;
    ids.push(invalid);
    const before = rows(
      await database().query("SELECT status, tier FROM billing_customers WHERE tenant_id=$1", [tenant]),
    );
    await database().query(
      `INSERT INTO billing_events(id,stripe_event_id,type,payload)
       VALUES ($1,$2,'invoice.paid',$3::jsonb)`,
      [
        randomUUID(),
        invalid,
        JSON.stringify({
          id: invalid,
          // A bad inbox record could otherwise execute a payment-failure transition.
          type: "invoice.payment_failed",
          created: 1_700_001_400,
          data: { object: { customer } },
        }),
      ],
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).dead_letter).toBe(1);
    const quarantined = await row(invalid);
    expect(quarantined?.processed_at).toBeNull();
    expect(quarantined?.dead_letter_at).not.toBeNull();
    expect(quarantined?.last_error_class).toBe("invalid_stored_event");
    const after = rows(
      await database().query("SELECT status, tier FROM billing_customers WHERE tenant_id=$1", [tenant]),
    );
    expect(after).toEqual(before);
  });

  it("preserves a canceled free entitlement against historical and newer invoice events", async () => {
    // Stripe sandbox provider truth can have paid invoices while the subscription
    // is now canceled. Invoice replay must never reactivate or mark it past_due.
    const failure = await enqueue("failure_before_cancel", "invoice.payment_failed", { customer }, 1_700_005_300);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(failure))?.processed_at).not.toBeNull();

    const canceled = await enqueue(
      "canceled_after_invoice",
      "customer.subscription.deleted",
      { ...subscription(), status: "canceled" },
      1_700_005_200,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(canceled))?.processed_at).not.toBeNull();
    expect(
      rows(
        await database().query("SELECT tier, status, grace_ends_at FROM billing_customers WHERE tenant_id=$1", [
          tenant,
        ]),
      )[0],
    ).toMatchObject({ tier: "free", status: "canceled", grace_ends_at: null });

    const paid = await enqueue("paid_after_cancel", "invoice.paid", { customer }, 1_700_005_400);
    const laterFailed = await enqueue("failed_after_cancel", "invoice.payment_failed", { customer }, 1_700_005_500);
    expect((await processStripeEntitlementPass(database(), { limit: 2 })).processed).toBe(2);
    expect((await row(paid))?.processed_at).not.toBeNull();
    expect((await row(laterFailed))?.processed_at).not.toBeNull();
    const current = rows(
      await database().query(
        "SELECT tier, status, grace_ends_at, last_invoice_event_outcome FROM billing_customers WHERE tenant_id=$1",
        [tenant],
      ),
    )[0];
    expect(current).toMatchObject({
      tier: "free",
      status: "canceled",
      grace_ends_at: null,
      last_invoice_event_outcome: "failed",
    });
    expect(
      rows(
        await database().query("SELECT status, tier FROM billing_subscriptions WHERE stripe_subscription_id=$1", [
          subscription().id,
        ]),
      )[0],
    ).toMatchObject({ status: "canceled", tier: "free" });
  });

  it("does not grant paid plans for terminal subscription.updated statuses", async () => {
    // A terminal status can arrive in subscription.updated, not only deleted.
    // Even a historically paid invoice must never grant entitlement on these states.
    const statuses = [
      { status: "canceled", customerStatus: "canceled" },
      { status: "unpaid", customerStatus: "canceled" },
      { status: "incomplete_expired", customerStatus: "canceled" },
      { status: "paused", customerStatus: "canceled" },
      { status: "unexpected_future_state", customerStatus: "canceled" },
      { status: "incomplete", customerStatus: "incomplete" },
    ] as const;
    for (const [index, { status, customerStatus }] of statuses.entries()) {
      const event = await enqueue(
        `terminal_update_${index}`,
        "customer.subscription.updated",
        { ...subscription(), status },
        1_700_006_000 + index,
      );
      const result = await processStripeEntitlementPass(database(), { limit: 1 });
      expect(result.processed).toBe(1);
      expect((await row(event))?.processed_at).not.toBeNull();
      const current = rows(
        await database().query("SELECT tier, status FROM billing_customers WHERE tenant_id=$1", [tenant]),
      )[0];
      expect(current).toMatchObject({ tier: "free", status: customerStatus });
      const stored = rows(
        await database().query("SELECT tier, status FROM billing_subscriptions WHERE stripe_subscription_id=$1", [
          subscription().id,
        ]),
      )[0];
      expect(stored).toMatchObject({ tier: "free", status });
    }
  });

  it("applies a same-second subscription state after paid invoice but preserves failed invoice state", async () => {
    const timestamp = 1_700_007_100;
    const invoice = await enqueue("paid_before_same_second_subscription", "invoice.paid", { customer }, timestamp);
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(invoice))?.processed_at).not.toBeNull();

    const trial = await enqueue(
      "trial_after_same_second_paid",
      "customer.subscription.created",
      { ...subscription(), status: "trialing" },
      timestamp,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(trial))?.processed_at).not.toBeNull();
    const afterTrial = rows(
      await database().query("SELECT status, last_invoice_event_outcome FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    )[0];
    expect(afterTrial).toMatchObject({ status: "trialing", last_invoice_event_outcome: "paid" });

    const failed = await enqueue(
      "failed_before_same_second_subscription",
      "invoice.payment_failed",
      { customer },
      timestamp + 100,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    const active = await enqueue(
      "active_after_same_second_failed",
      "customer.subscription.updated",
      subscription(),
      timestamp + 100,
    );
    expect((await processStripeEntitlementPass(database(), { limit: 1 })).processed).toBe(1);
    expect((await row(failed))?.processed_at).not.toBeNull();
    expect((await row(active))?.processed_at).not.toBeNull();
    const afterFailure = rows(
      await database().query("SELECT status, last_invoice_event_outcome FROM billing_customers WHERE tenant_id=$1", [
        tenant,
      ]),
    )[0];
    expect(afterFailure).toMatchObject({ status: "past_due", last_invoice_event_outcome: "failed" });
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
