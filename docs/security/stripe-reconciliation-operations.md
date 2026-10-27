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
  An invoice must identify its source Stripe subscription, either through the
  legacy `subscription` field or `parent.subscription_details.subscription`.
  An invoice with no source, contradictory source fields, or a source conflicting
  with the tenant's current eligible subscription must not change grace or
  billing status. Source identity must also match a subscription persisted for
  that tenant even when no active subscription remains. A different source is
  quarantined as `ambiguous_invoice_subscription` (or
  `unrecognized_stripe_payload` for mutually contradictory references).
  If no subscription has been recorded yet, a source-bound invoice is deferred
  as `subscription_not_linked` for bounded retries; it is never granted access
  based on customer identity alone.
  Investigate subscription ownership and current Stripe provider truth before
  any explicit single-event recovery; a paid invoice from a canceled/other
  subscription does not grant current plan entitlement.
  A checkout also cannot silently rebind an existing tenant to another Stripe
  customer or link one Stripe customer to a second tenant: both attempts are
  quarantined as `ambiguous_customer_linkage` for manual provider/ownership
  verification. An identical tenant/customer replay remains idempotent.

- Unmapped subscription prices are retried with exponential backoff and
  quarantined after 12 attempts as `unmapped_stripe_price` (or
  `stripe_price_config_missing`); they are never silently acknowledged as
  applied. Correcting the price mapping alone does **not** replay a dead letter.
  Review the current provider state and operator authorization, then follow the
  explicit single-event requeue procedure below. Monitor **both** pending and
  dead-letter counts rather than assuming a mapping change drains the queue.
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

**Deployment HOLD:** migration 0103 depends on 0102. Separate, still-HOLD
legal-hold Draft PR #1080 now uses additive migration 0104 after main's
0095–0101 and this Stripe Draft's 0102–0103. A noncolliding migration sequence
is only schema compatibility evidence, **not** approval to combine rollouts or
proof that old physical-unlink workers are safe. The legal-hold rollout requires
independent operator authorization, a complete worker inventory and quiescence
of all pre-fencing unlink actors before its migration and worker cutover.
Stop all legacy inline entitlement-mutating webhook instances before enabling
the new Stripe worker; a mixed-version rollout bypasses its transactional
protocol. Verify schema, worker readiness, no legacy writers, replay isolation,
alarms, and genuine Stripe test-mode deliveries before enabling production paid
billing. Neither green CI nor merge approval authorizes either live rollout.
