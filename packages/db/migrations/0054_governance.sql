-- Governance: org policies and inheritance
CREATE TABLE IF NOT EXISTS review_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('organization','team','repository')),
  scope_id TEXT,
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 128),
  description TEXT,
  required_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  severity_gate TEXT CHECK (severity_gate IN ('error','high','medium')),
  require_evidence_pack BOOLEAN NOT NULL DEFAULT FALSE,
  require_external_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_policies_tenant_scope ON review_policies(tenant_id, scope, scope_id);
