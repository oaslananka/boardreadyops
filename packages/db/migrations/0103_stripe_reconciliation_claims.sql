-- Durable Stripe inbox consumed by the already-deployed control-plane worker.
-- Row locks are held through projection and acknowledgement; crashes roll both back.
ALTER TABLE billing_events
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_class text;
ALTER TABLE billing_customers
  ADD COLUMN IF NOT EXISTS last_invoice_event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_invoice_event_outcome text
    CHECK (last_invoice_event_outcome IN ('paid', 'failed'));

CREATE INDEX IF NOT EXISTS idx_billing_events_due_stripe
  ON billing_events (available_at, created_at, id)
  WHERE provider='stripe' AND processed_at IS NULL AND dead_letter_at IS NULL;
-- The existing idx_billing_events_pending_stripe_customer (0102) remains
-- the targeted lookup for reawakening pre-checkout subscription/invoice events.
