CREATE TABLE IF NOT EXISTS finding_decisions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  finding_fingerprint TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('accepted_risk', 'false_positive', 'mitigated', 'fix_required', 'deferred')),
  reason TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  evidence_digest TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_accepted_risk_reason_length CHECK (
    disposition != 'accepted_risk' OR length(reason) >= 20
  )
);

CREATE INDEX IF NOT EXISTS idx_finding_decisions_review_fingerprint
  ON finding_decisions (review_id, finding_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finding_decisions_repo_fingerprint
  ON finding_decisions (repository_id, finding_fingerprint);

CREATE TABLE IF NOT EXISTS finding_assignments (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  finding_fingerprint TEXT NOT NULL,
  assignee TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_finding_assignment UNIQUE (review_id, finding_fingerprint, assignee)
);

CREATE INDEX IF NOT EXISTS idx_finding_assignments_review
  ON finding_assignments (review_id);

CREATE INDEX IF NOT EXISTS idx_finding_assignments_assignee
  ON finding_assignments (assignee, repository_id);

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE,
  finding_fingerprint TEXT,
  evidence_anchor TEXT,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'internal' CHECK (author_type IN ('internal', 'guest')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'stale')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_comments_review_parent
  ON review_comments (review_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_review_comments_finding
  ON review_comments (review_id, finding_fingerprint);

CREATE TABLE IF NOT EXISTS review_approvals (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'changes_requested', 'invalidated', 'dismissed')),
  reason TEXT,
  is_break_glass BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at TIMESTAMPTZ,
  invalidated_by TEXT,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_approvals_review_created
  ON review_approvals (review_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_checklist_items (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_checklist_review
  ON review_checklist_items (review_id);
