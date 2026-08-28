-- 0057_review_approval_uniqueness.sql
-- Safely normalize any pre-existing duplicate active review approvals by invalidating older duplicates
WITH ranked_approvals AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY review_id, revision_id, approver_id, status
      ORDER BY created_at DESC, id DESC
    ) as rank
  FROM review_approvals
  WHERE status IN ('approved', 'changes_requested') AND invalidated_at IS NULL
)
UPDATE review_approvals
SET
  status = 'invalidated',
  invalidated_at = NOW(),
  invalidated_by = 'migration_0057',
  invalidation_reason = 'Deduplicated during schema v57 migration',
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_approvals WHERE rank > 1
);

-- Enforce database-level uniqueness per approver, review, revision, and status for active decisions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_approval_active_decision
  ON review_approvals (review_id, revision_id, approver_id, status)
  WHERE status IN ('approved', 'changes_requested') AND invalidated_at IS NULL;
