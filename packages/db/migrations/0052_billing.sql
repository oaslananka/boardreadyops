-- Billing: active-contributor subscriptions, Stripe event ledger, workspace memberships
CREATE TABLE IF NOT EXISTS billing_customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  tier TEXT NOT NULL CHECK (tier IN ('free','team','business','enterprise')),
  status TEXT NOT NULL CHECK (status IN ('active','trialing','past_due','canceled','incomplete')),
  trial_ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_customers_tenant ON billing_customers(tenant_id);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES billing_customers(tenant_id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free','team','business','enterprise')),
  interval TEXT NOT NULL CHECK (interval IN ('month','year')),
  status TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tenant ON billing_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events(type);
CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id);

CREATE TABLE IF NOT EXISTS billing_activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('internal','guest','system')),
  action TEXT NOT NULL CHECK (action IN ('policy_update','disposition','release_create','workspace_manage','comment','approval')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_activity_tenant_actor ON billing_activity(tenant_id, actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_activity_tenant_month ON billing_activity(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_tenant ON workspace_memberships(tenant_id);
