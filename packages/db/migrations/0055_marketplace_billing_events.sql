-- Marketplace and generic billing provider event tracking
ALTER TABLE billing_events ALTER COLUMN stripe_event_id DROP NOT NULL;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS delivery_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_delivery ON billing_events(delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_events_provider ON billing_events(provider);
