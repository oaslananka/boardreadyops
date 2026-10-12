import { BillingStore } from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { projectEntitlement, storedStripeEvent } from "./stripe-entitlement-projection.js";

type StripeEventRow = { id: string; stripe_event_id: string; type: string; payload: unknown };
type Result = "processed" | "deferred" | "dead_letter" | "failed" | "idle";

function records(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function eventCustomer(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("object" in data)) return;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object" || !("customer" in object)) return;
  const customer = (object as { customer?: unknown }).customer;
  return typeof customer === "string" && customer.length > 0 ? customer : undefined;
}

/**
 * Process a small batch in the existing cloud worker, with no Stripe network calls.
 * Each event's entitlement changes and processed_at commit atomically on the same
 * PostgreSQL connection. Row locks, not expiring leases, release on crash.
 */
export async function processStripeEntitlementPass(
  executor: PgQueryExecutor,
  options: { limit?: number } = {},
): Promise<Record<Exclude<Result, "idle">, number>> {
  const limit = Math.max(1, Math.min(25, Math.floor(options.limit ?? 10)));
  const outcomes = { processed: 0, deferred: 0, dead_letter: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    let claimedId: string | undefined;
    let outcome: Result;
    try {
      outcome = await executor.withTransaction(async (transaction) => {
        const selected = records(
          await transaction.query(
            `SELECT id, stripe_event_id, type, payload FROM billing_events
           WHERE provider='stripe' AND processed_at IS NULL AND dead_letter_at IS NULL
             AND available_at <= now()
           ORDER BY available_at, created_at, id
           FOR UPDATE SKIP LOCKED LIMIT 1`,
          ),
        );
        const record = selected[0] as StripeEventRow | undefined;
        if (!record) return "idle";
        claimedId = record.id;
        const event = storedStripeEvent(record.payload);
        if (
          !event ||
          event.id !== record.stripe_event_id ||
          typeof event.created !== "number" ||
          !Number.isSafeInteger(event.created) ||
          event.created <= 0
        ) {
          await transaction.query(
            `UPDATE billing_events SET dead_letter_at=NOW(), last_error_class='invalid_stored_event'
             WHERE id=$1`,
            [record.id],
          );
          return "dead_letter";
        }

        const customer = eventCustomer(event);
        if (customer) {
          // Serializes different events for the same customer across all worker
          // replicas, while the event row itself prevents duplicate processing.
          const lock = records(
            await transaction.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired", [
              customer,
            ]),
          );
          if (lock[0]?.acquired !== true) {
            // Never wait for a customer mutex while holding an event row lock:
            // checkout wakes other event rows while owning the same mutex.
            await transaction.query("UPDATE billing_events SET available_at=NOW() + INTERVAL '1 second' WHERE id=$1", [
              record.id,
            ]);
            return "deferred";
          }
        }
        const projection = await projectEntitlement(new BillingStore(transaction), event);
        if (
          projection.entitlement === "ignored" &&
          typeof projection.reason === "string" &&
          projection.reason.startsWith("unrecognized_")
        ) {
          // A recognized event type with an invalid object must not be silently
          // acknowledged as processed. Preserve it for operator reconciliation.
          await transaction.query(
            "UPDATE billing_events SET dead_letter_at=NOW(), last_error_class='unrecognized_stripe_payload' WHERE id=$1",
            [record.id],
          );
          return "dead_letter";
        }
        if (projection.entitlement === "deferred") {
          await transaction.query(
            `UPDATE billing_events SET available_at=NOW() + INTERVAL '60 seconds'
             WHERE id=$1 AND processed_at IS NULL`,
            [record.id],
          );
          return "deferred";
        }
        await transaction.query(
          "UPDATE billing_events SET processed_at=NOW(), last_error_class=NULL WHERE id=$1 AND processed_at IS NULL",
          [record.id],
        );
        return "processed";
      });
    } catch (error) {
      if (claimedId) {
        const errorName = error instanceof Error ? error.name.slice(0, 80) : "UnknownError";
        // A failed DB transaction rolled back the entire projection. The
        // conditional update avoids overwriting a different worker's success.
        try {
          await executor.query(
            `UPDATE billing_events SET attempts=attempts+1,
               available_at=NOW() + make_interval(secs => LEAST(3600, (5 * power(2, LEAST(attempts, 9)))::integer)),
               dead_letter_at=CASE WHEN attempts + 1 >= 12 THEN NOW() ELSE NULL END,
               last_error_class=$2
             WHERE id=$1 AND processed_at IS NULL AND dead_letter_at IS NULL`,
            [claimedId, errorName],
          );
        } catch {
          // A DB outage leaves the event durable and due for the next pass.
        }
      }
      outcome = "failed";
    }
    if (outcome === "idle") break;
    outcomes[outcome]++;
    // Avoid monopolizing the pool during an outage or malformed event burst.
    if (outcome === "failed") break;
  }
  return outcomes;
}
