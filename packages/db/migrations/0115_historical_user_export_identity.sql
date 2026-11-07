-- Preserve only numeric GitHub identity proven by signed installation events
-- or a separately verified OAuth identity. Historical login-only exports are
-- deliberately NOT backfilled: reused/renamed usernames cannot prove ownership.
ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS account_user_id bigint
  CHECK (account_user_id IS NULL OR account_user_id > 0);

ALTER TABLE data_exports
  ADD COLUMN IF NOT EXISTS original_github_user_id bigint
  CHECK (
    original_github_user_id IS NULL OR
    (original_github_user_id > 0
     AND scope = 'user'
     AND installation_id IS NULL
     AND scope_id IS NOT NULL
     AND lower(scope_id) = lower(tenant_id))
  );

CREATE INDEX IF NOT EXISTS idx_data_exports_historical_user_identity
  ON data_exports(original_github_user_id, created_at DESC)
  WHERE original_github_user_id IS NOT NULL AND scope='user' AND installation_id IS NULL;

INSERT INTO cloud_schema_migrations(version)
VALUES ('0115_historical_user_export_identity')
ON CONFLICT (version) DO NOTHING;
