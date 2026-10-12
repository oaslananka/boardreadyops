import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { BillingStore } from "../../packages/db/src/billing-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const synthetic = randomUUID();
const customer = `cus_test_${synthetic}`;
const unrelatedCustomer = `cus_other_${synthetic}`;
const insertedIds: string[] = [];

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

afterAll(async () => {
  if (!executor) return;
  await database().query("DELETE FROM billing_events WHERE stripe_event_id = ANY($1::text[])", [insertedIds]);
  await executor.close();
});

describeDatabase("pending Stripe events indexed customer lookup (PostgreSQL)", () => {
  it("wakes only pending events for the linked customer, not processed, dead-lettered or unrelated ones", async () => {
    const records: Array<[string, string, boolean, boolean]> = [
      ["subscription", customer, false, false],
      ["invoice", customer, false, false],
      ["unknown", customer, false, false],
      ["processed", customer, true, false],
      ["quarantined", customer, false, true],
      ["other", unrelatedCustomer, false, false],
    ];
    for (const [suffix, customerId, processed, deadLetter] of records) {
      const id = `evt_${suffix}_${synthetic}`;
      insertedIds.push(id);
      await database().query(
        `INSERT INTO billing_events
           (id, stripe_event_id, type, provider, payload, processed_at, dead_letter_at, available_at)
         VALUES ($1, $2, 'invoice.paid', 'stripe', $3::jsonb,
                 CASE WHEN $4 THEN NOW() ELSE NULL END,
                 CASE WHEN $5 THEN NOW() ELSE NULL END,
                 NOW() + INTERVAL '1 hour')`,
        [randomUUID(), id, JSON.stringify({ id, data: { object: { customer: customerId } } }), processed, deadLetter],
      );
    }
    await new BillingStore(database()).wakePendingStripeCustomerEvents(customer);
    const rows = (await database().query(
      "SELECT stripe_event_id, available_at <= now() AS due FROM billing_events WHERE stripe_event_id=ANY($1::text[])",
      [insertedIds],
    )) as { rows?: Array<{ stripe_event_id: string; due: boolean }> };
    const due = new Map((rows.rows ?? []).map(({ stripe_event_id, due }) => [stripe_event_id, due]));
    expect(due.get(`evt_subscription_${synthetic}`)).toBe(true);
    expect(due.get(`evt_invoice_${synthetic}`)).toBe(true);
    expect(due.get(`evt_unknown_${synthetic}`)).toBe(true);
    expect(due.get(`evt_processed_${synthetic}`)).toBe(false);
    expect(due.get(`evt_quarantined_${synthetic}`)).toBe(false);
    expect(due.get(`evt_other_${synthetic}`)).toBe(false);
  });

  it("defines a valid partial customer-expression index for targeted wakeups", async () => {
    // A tiny fixture does not constrain PostgreSQL's optimizer to choose this
    // index over another valid index. Assert the deployed index contract instead.
    const result = (await database().query(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition,
              pg_get_expr(i.indpred, i.indrelid) AS predicate,
              i.indisvalid AS valid, i.indisready AS ready
       FROM pg_index AS i
       WHERE i.indexrelid = to_regclass('idx_billing_events_pending_stripe_customer')
         AND i.indrelid = 'billing_events'::regclass`,
    )) as { rows?: Array<{ definition: string; predicate: string; valid: boolean; ready: boolean }> };
    expect(result.rows).toHaveLength(1);
    const index = result.rows?.[0];
    expect(index?.valid).toBe(true);
    expect(index?.ready).toBe(true);
    expect(index?.definition).toContain("payload #>>");
    expect(index?.definition).toContain("{data,object,customer}");
    expect(index?.definition).toContain("created_at");
    expect(index?.definition).toContain("id");
    expect(index?.predicate).toContain("provider = 'stripe'");
    expect(index?.predicate).toContain("processed_at IS NULL");
  });
});
