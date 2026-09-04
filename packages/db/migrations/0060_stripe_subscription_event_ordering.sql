-- Guards Stripe subscription projection against out-of-order webhook delivery. Stripe does
-- not guarantee delivery order (retries and redeliveries can arrive after a newer event), so a
-- delayed customer.subscription.* event for an earlier state must not clobber a later one.
-- last_event_created_at stores the Stripe *event's* own `created` timestamp (not the
-- subscription object's, which does not change per-event) -- Stripe's own guidance for
-- resolving delivery order.
ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS last_event_created_at TIMESTAMPTZ;
