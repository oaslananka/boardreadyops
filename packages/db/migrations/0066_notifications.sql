-- Outbound notification channels and their delivery outbox.
--
-- The control plane could detect that a board was blocked or a part had gone end-of-life but had
-- no way to tell anyone; the only notification code in the repository belonged to the CLI and ran
-- on a developer's machine. Deliveries are a leased, retried outbox rather than an inline POST so
-- a slow or broken Slack workspace cannot stall a supply-watch pass or a release run.

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('slack','webhook')),
  -- The destination URL. Treated as a credential: it is never returned to a client in full.
  destination TEXT NOT NULL,
  -- Short label a person chose, so a list of three webhooks is readable.
  label TEXT NOT NULL,
  subscribed_events TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivered_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  -- One destination per installation: adding the same webhook twice only doubles the noise.
  UNIQUE (installation_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_installation
  ON notification_channels(installation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  -- Identity of the news, not of the attempt. A supply-watch pass that re-runs re-derives the
  -- same key for a part it already announced, and the unique index below drops the duplicate.
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivering','delivered','failed','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (channel_id, dedupe_key)
);

-- The claim query's access path: pending rows that are due, oldest first.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON notification_deliveries(next_attempt_at)
  WHERE status IN ('pending','delivering');

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel
  ON notification_deliveries(channel_id, created_at DESC);
