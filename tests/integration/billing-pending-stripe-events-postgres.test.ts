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

  it("uses the partial customer expression index for targeted wakeups", async () => {
    const client = createPgQueryExecutor({ connectionString: connectionString as string, max: 1 });
    try {
      await client.withTransaction(async (transaction) => {
        await transaction.query("SET LOCAL enable_seqscan=off");
        const plan = (await transaction.query(
          `EXPLAIN (FORMAT JSON) UPDATE billing_events SET available_at=NOW()
           WHERE provider='stripe' AND processed_at IS NULL AND dead_letter_at IS NULL
             AND payload #>> '{data,object,customer}'=$1`,
          [customer],
        )) as { rows?: Array<Record<string, unknown>> };
        expect(JSON.stringify(plan.rows?.[0]?.["QUERY PLAN"])).toContain("idx_billing_events_pending_stripe_customer");
      });
    } finally {
      await client.close();
    }
  });
});
