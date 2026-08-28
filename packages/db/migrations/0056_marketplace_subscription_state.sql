-- Provider-isolated GitHub Marketplace subscription state and cancellation lifecycle tracking.
CREATE TABLE IF NOT EXISTS github_marketplace_subscriptions (
  github_account_id BIGINT PRIMARY KEY,
  account_login TEXT NOT NULL,
  account_type TEXT,
  github_installation_id BIGINT,
  plan_id BIGINT,
  plan_name TEXT,
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier = 'free'),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
  effective_at TIMESTAMPTZ NOT NULL,
  last_delivery_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_marketplace_subscriptions_canceled_login
  ON github_marketplace_subscriptions(lower(account_login))
  WHERE status = 'canceled';
CREATE INDEX IF NOT EXISTS idx_github_marketplace_subscriptions_canceled_installation
  ON github_marketplace_subscriptions(github_installation_id)
  WHERE status = 'canceled' AND github_installation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_marketplace_subscriptions_status
  ON github_marketplace_subscriptions(status, effective_at DESC);

ALTER TABLE erasure_requests ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_erasure_requests_active_marketplace_account
  ON erasure_requests(tenant_id, scope)
  WHERE requested_by = 'github_marketplace'
    AND scope IN ('organization', 'user')
    AND status IN ('pending', 'running', 'blocked_by_hold');
CREATE INDEX IF NOT EXISTS idx_erasure_requests_due
  ON erasure_requests(due_at)
  WHERE status IN ('pending', 'blocked_by_hold');
