-- A Review revision created by trusted run ingestion can retain the server-resolved
-- organization/repository policy observed in that transaction. Older revisions stay NULL
-- (unknown), not retroactively inferred from current settings.
ALTER TABLE public.review_revisions
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_revisions_policy_snapshot_shape'
      AND conrelid = 'public.review_revisions'::regclass
  ) THEN
    ALTER TABLE public.review_revisions ADD CONSTRAINT review_revisions_policy_snapshot_shape
    CHECK (
      policy_snapshot IS NULL OR
      (jsonb_typeof(policy_snapshot) = 'object' AND pg_column_size(policy_snapshot) <= 16384)
    );
  END IF;
END $$;
INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0111_review_policy_run_ingestion_snapshot')
ON CONFLICT (version) DO NOTHING;
