-- Bounded metadata preview availability; not a completed customer export.
ALTER TABLE data_exports
 ADD COLUMN IF NOT EXISTS manifest_preview_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS manifest_preview_revoked_at timestamptz;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='data_exports_manifest_preview_requires_bytes' AND conrelid='data_exports'::regclass) THEN
  ALTER TABLE data_exports ADD CONSTRAINT data_exports_manifest_preview_requires_bytes CHECK (
   manifest_preview_expires_at IS NULL OR (
    prepared_manifest_bytes IS NOT NULL AND prepared_manifest_sha256 IS NOT NULL
    AND prepared_manifest_at IS NOT NULL
   )
  );
 END IF;
END $$;
