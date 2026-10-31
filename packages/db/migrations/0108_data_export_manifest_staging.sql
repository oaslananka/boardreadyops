-- Bound, operator-only preparation staging. No customer download route,
-- automated worker, completed status or erasure is enabled by this migration.
-- At most 64 KiB per export is stored in the existing PostgreSQL boundary.
ALTER TABLE data_exports
  ADD COLUMN IF NOT EXISTS prepared_manifest_bytes bytea,
  ADD COLUMN IF NOT EXISTS prepared_manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS prepared_manifest_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'data_exports_prepared_manifest_bounded'
       AND conrelid = 'data_exports'::regclass
  ) THEN
    ALTER TABLE data_exports
      ADD CONSTRAINT data_exports_prepared_manifest_bounded CHECK (
        (prepared_manifest_bytes IS NULL AND prepared_manifest_sha256 IS NULL AND prepared_manifest_at IS NULL)
        OR (
          prepared_manifest_bytes IS NOT NULL
          AND octet_length(prepared_manifest_bytes) BETWEEN 1 AND 65536
          AND prepared_manifest_sha256 IS NOT NULL
          AND prepared_manifest_sha256 ~ '^[0-9a-f]{64}$'
          AND prepared_manifest_at IS NOT NULL
          AND status IN ('running', 'completed')
        )
      );
  END IF;
END $$;
