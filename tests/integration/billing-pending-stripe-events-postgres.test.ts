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
  it("returns only pending supported events for the exact Stripe customer in creation order", async () => {
    const testRows: Array<[string, string, string, boolean, number]> = [
      ["late", customer, "customer.subscription.updated", false, 1],
      ["early", customer, "invoice.payment_failed", false, 3],
      ["processed", customer, "customer.subscription.deleted", true, 2],
      ["unrelated", unrelatedCustomer, "customer.subscription.created", false, 0],
      ["unsupported", customer, "made.up.type", false, 0],
      ["middle", customer, "invoice.paid", false, 2],
    ];
    for (const [suffix, customerId, type, processed, minutesAgo] of testRows) {
      const id = `evt_${suffix}_${synthetic}`;
      insertedIds.push(id);
      await database().query(
        `INSERT INTO billing_events (id, stripe_event_id, type, provider, payload, processed_at, created_at)
         VALUES ($1, $2, $3, 'stripe', $4::jsonb, CASE WHEN $5 THEN NOW() ELSE NULL END,
                 NOW() - $6::integer * INTERVAL '1 minute')`,
        [
          randomUUID(),
          id,
          type,
          JSON.stringify({ id, type, data: { object: { customer: customerId } } }),
          processed,
          minutesAgo,
        ],
      );
    }
    const store = new BillingStore(database());
    const events = (await store.pendingStripeCustomerEvents(customer)) as Array<{ id: string }>;
    expect(events.map((event) => event.id)).toEqual([
      `evt_early_${synthetic}`,
      `evt_middle_${synthetic}`,
      `evt_late_${synthetic}`,
    ]);
  });

  it("uses the partial expression index for the same customer lookup predicate", async () => {
    const client = createPgQueryExecutor({ connectionString: connectionString as string, max: 1 });
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const result = await client.query(
        `EXPLAIN (FORMAT JSON) SELECT payload FROM billing_events
         WHERE provider='stripe' AND processed_at IS NULL
           AND type IN ('customer.subscription.created', 'customer.subscription.updated',
                        'customer.subscription.deleted', 'invoice.payment_failed', 'invoice.paid')
           AND payload #>> '{data,object,customer}' = $1
         ORDER BY created_at ASC, id ASC LIMIT 100`,
        [customer],
      );
      const planRows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
      expect(JSON.stringify(planRows[0]?.["QUERY PLAN"])).toContain("idx_billing_events_pending_stripe_customer");
      await client.query("ROLLBACK");
    } finally {
      await client.close();
    }
  });
});
