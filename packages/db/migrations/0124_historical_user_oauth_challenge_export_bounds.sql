-- Source-only / customer export NO_GO. Bounded historical OAuth audit rows
-- are retained until their original export is lawfully removed.
-- This index serves both the per-export lifetime and rolling 5m quota.
CREATE INDEX IF NOT EXISTS historical_user_oauth_challenges_export_created
  ON public.historical_user_oauth_challenges(export_id,created_at);

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0124_historical_user_oauth_challenge_export_bounds')
ON CONFLICT(version) DO NOTHING;
