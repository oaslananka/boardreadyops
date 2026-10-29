-- Accelerate pending out-of-order Stripe webhook lookup after checkout customer linking.
-- The customer is not linked to a tenant when the event first arrives, so index
-- the verified Stripe payload's customer identifier (not a guessed tenant ID).
-- Intentionally partial: processed events and Marketplace events never participate.
CREATE INDEX IF NOT EXISTS idx_billing_events_pending_stripe_customer
ON billing_events ((payload #>> '{data,object,customer}'), created_at, id)
WHERE provider = 'stripe' AND processed_at IS NULL;
