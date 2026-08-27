CREATE TABLE IF NOT EXISTS external_review_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read_only', 'comment_only', 'approve_only')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_review_tenant_review ON external_review_invitations (tenant_id, review_id);
CREATE INDEX IF NOT EXISTS idx_ext_review_token_hash ON external_review_invitations (token_hash);
