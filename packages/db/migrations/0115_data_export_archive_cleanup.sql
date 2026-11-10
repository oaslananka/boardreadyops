-- A durable, one-way cleanup marker for claim-bound private ZIP bytes.
-- The previous immutable digest and stage/revocation audit remain intact.
-- Absence of physical bytes is not proof of a successful customer download.
ALTER TABLE data_export_archive_commitments
  ADD COLUMN IF NOT EXISTS cleaned_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleanup_result text
    CHECK (cleanup_result IN ('deleted', 'missing'));
ALTER TABLE data_export_archive_commitments
  ADD CONSTRAINT data_export_archive_cleanup_pair CHECK (
    (cleaned_at IS NULL AND cleanup_result IS NULL)
    OR (cleaned_at IS NOT NULL AND cleanup_result IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS idx_data_export_archive_commitments_cleanup_candidates
  ON data_export_archive_commitments(expires_at)
  WHERE cleaned_at IS NULL;
INSERT INTO cloud_schema_migrations(version)
VALUES ('0115_data_export_archive_cleanup')
ON CONFLICT (version) DO NOTHING;
