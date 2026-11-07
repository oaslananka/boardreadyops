-- A claim-bound, expiring internal ZIP commitment is NOT a customer delivery.
-- It stores only digest/size/count: no archive bytes, external URL, object path,
-- completed export status or authority to publish/retrieve. A future delivery
-- edge must prove durable bytes and independently reauthorize the requester.
CREATE TABLE IF NOT EXISTS data_export_archive_commitments (
  export_id text PRIMARY KEY REFERENCES data_exports(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_byte_length integer NOT NULL CHECK (archive_byte_length BETWEEN 1 AND 67108864),
  archive_files integer NOT NULL CHECK (archive_files BETWEEN 8 AND 108),
  staged_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT data_export_archive_commitment_expiry CHECK (expires_at > staged_at)
);
CREATE INDEX IF NOT EXISTS idx_data_export_archive_commitments_expiry
  ON data_export_archive_commitments(expires_at)
  WHERE revoked_at IS NULL;

INSERT INTO cloud_schema_migrations(version)
VALUES ('0113_data_export_archive_commitments')
ON CONFLICT (version) DO NOTHING;
