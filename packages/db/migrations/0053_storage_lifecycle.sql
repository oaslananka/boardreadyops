-- Storage lifecycle: retention, exports, erasures, legal holds
CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free','team','business','enterprise')),
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days > 0),
  source_retention_hours INTEGER NOT NULL DEFAULT 24 CHECK (source_retention_hours > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
);
CREATE TABLE IF NOT EXISTS data_exports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  scope TEXT NOT NULL CHECK (scope IN ('organization','repository','user')),
  scope_id TEXT,
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_data_exports_tenant ON data_exports(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS erasure_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('organization','repository','user')),
  scope_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('preview','pending','running','completed','failed','blocked_by_hold')),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_erasure_requests_tenant ON erasure_requests(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS legal_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) >= 10),
  scope TEXT NOT NULL CHECK (scope IN ('organization','repository','user')),
  scope_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  released_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_legal_holds_tenant_active ON legal_holds(tenant_id, active) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name IN ('local_run_succeeded','cloud_review_created','review_second_user_acted','finding_dispositioned','review_approved','review_changes_requested','evidence_pack_created','external_review_opened','trial_started','subscription_activated','subscription_downgraded','data_export_completed')),
  tenant_id TEXT NOT NULL,
  repository_id TEXT,
  review_id TEXT,
  actor_class TEXT NOT NULL CHECK (actor_class IN ('internal','guest','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_events_tenant_time ON product_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_time ON product_events(event_name, created_at DESC);
