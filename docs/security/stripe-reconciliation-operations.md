# Stripe entitlement reconciliation — runtime acceptance and recovery

The Stripe webhook verifies the signature and stores the event durably before
returning HTTP 200. No entitlement projection, subscription replay, or external
Stripe API call runs on the webhook request path. If the database is disabled or
the insert fails, the endpoint must not return a success acknowledgment.

The existing control-plane worker polls the `billing_events` inbox. Each pass
handles a bounded batch (default 10, allowed 1–25) using a pinned PostgreSQL
transaction per event. `FOR UPDATE SKIP LOCKED` excludes a record claimed by
another replica; a **non-blocking** transaction-scoped advisory lock serializes
different events for the same Stripe customer. Subscription and invoice
projections, customer linkage, pending-event wakeups and `processed_at` updates
commit together. A process crash or SQL failure rolls back the projection and
releases PostgreSQL locks. No elapsed wall-clock lease can authorize a second
writer while the first transaction remains live.

Environment overrides (worker only, no separate service):
- `BOARDREADYOPS_STRIPE_RECONCILIATION_POLL_MS`: 1,000–60,000; default 5,000
- `BOARDREADYOPS_STRIPE_RECONCILIATION_BATCH_SIZE`: 1–25; default 10

Operational guarantees and limits:

- Normal throughput is handled automatically by the worker. A subscription or
  invoice event preceding checkout is postponed 60 seconds; linking the Stripe
  customer releases that customer's pending records immediately.
- Failed SQL projections roll back before a bounded exponential retry. Deferred
  events (missing customer linkage or Stripe price mapping) also use the existing
  durable attempt budget, with exponential delays from 60 seconds up to one hour.
  Twelve attempts (including earlier SQL failures) quarantine the event rather
  than repeatedly occupying the oldest due-queue slots. Checkout linkage
  immediately wakes matching pending rows **and** matching quarantined
  `customer_not_linked` rows, resetting the attempt budget; unrelated dead
  letters remain quarantined. Correct price configuration and explicitly
  requeue `unmapped_stripe_price` / `stripe_price_config_missing` events only
  after provider-state/operator review. Invalid persisted event metadata is
  quarantined immediately. No event payload, customer identifier, payment
  detail, or webhook signature is logged.
- Subscription updates guard against an older Stripe event timestamp.
  Invoice paid/failed updates have a separate customer-level monotonic guard;
  an earlier subscription must not undo a later invoice status.
- Stripe timestamps have **second** precision. A second, opposite invoice
  outcome at the same event timestamp is quarantined with
  `ambiguous_invoice_order`, never silently acknowledged as processed.
  The earlier outcome may still be wrong: reconcile the live provider state
  before granting, revoking, or restoring an entitlement. Same-second
  subscription changes are now likewise quarantined as
  "ambiguous_subscription_order" rather than permitting a same-second overwrite;
  they still require independently verified provider-state comparison before
  production billing acceptance. If an already-linked tenant has another
  nonterminal Stripe subscription, the competing event is quarantined as
  `ambiguous_multi_subscription` before mutating customer or installation plans.
  This guard does not establish multi-subscription precedence; authorized
  provider-state reconciliation is still required before releasing the event.
- Unmapped subscription prices remain pending, not silently acknowledged as
  applied. Fix the mapping first; monitor the pending queue for accumulation.
- A successful transaction is an internal atomicity guarantee, **not** proof
  of provider consistency, paid-plan acceptance, or customer compliance.

Read-only operator inventory (never print `payload`):

```sql
SELECT count(*) FILTER (WHERE processed_at IS NULL AND dead_letter_at IS NULL) AS pending,
       count(*) FILTER (WHERE processed_at IS NULL AND dead_letter_at IS NOT NULL) AS dead_letter,
       max(attempts) FILTER (WHERE processed_at IS NULL) AS highest_attempt_count
  FROM billing_events WHERE provider='stripe';
```

The worker emits aggregate `worker.stripe_reconciliation` logs on each nonempty
pass. Alert when dead-letter count is positive, attempts repeatedly grow,
or pending age exceeds the configured recovery objective. SQL credentials,
customer payloads and Stripe event bodies must not be placed in alerts.

Dead-letter recovery is **reviewed and explicit**, not an automatic TTL reset:
identify the affected event by its existing Stripe event ID through authorized
billing administration, compare the latest Stripe subscription/invoice status,
correct missing configuration/authorization, document the operator and reason,
then re-enable only that single row within a controlled transaction. Never
blindly replay large batches or manually change customer entitlements. Keep the
audit trail of the original event and incident outside the public issue/PR.

**Deployment HOLD:** migration 0096 depends on 0095. Before deploying, reconcile
with the separate, still-HOLD legal-hold migration 0094. Stop all legacy
inline entitlement-mutating webhook instances before enabling the new worker;
a mixed-version rollout bypasses the new transactional protocol. Verify schema,
worker readiness, no legacy writers, replay isolation, alarms, and genuine
Stripe test-mode deliveries before enabling production paid billing. Merge
approval alone does not authorize a live billing rollout.
