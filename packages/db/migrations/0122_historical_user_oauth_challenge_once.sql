-- SOURCE ONLY / CUSTOMER ZIP NO_GO. Store only SHA-256 of random OAuth state.
-- A conditional UPDATE consumes this challenge at most once across workers.
-- Challenge records survive until lawful original-export parent deletion.
CREATE TABLE IF NOT EXISTS public.historical_user_oauth_challenges (
  state_sha256 text PRIMARY KEY CHECK (state_sha256 ~ '^[0-9a-f]{64}$'),
  export_id text NOT NULL REFERENCES public.data_exports(id) ON DELETE CASCADE,
  original_github_user_id bigint NOT NULL CHECK (original_github_user_id > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  purpose text NOT NULL DEFAULT 'historical-user-oauth-private-authentication'
    CHECK (purpose = 'historical-user-oauth-private-authentication'),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS historical_user_oauth_challenges_export_expiry
  ON public.historical_user_oauth_challenges(export_id,expires_at)
  WHERE consumed_at IS NULL;

-- Challenge identity and expiry are immutable. Only a NULL->timestamp
-- consumed_at transition is permitted and it may never be undone.
CREATE OR REPLACE FUNCTION public.boardreadyops_guard_historical_oauth_challenge()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.data_exports e WHERE e.id=OLD.export_id) THEN
      RAISE EXCEPTION 'historical OAuth challenge cannot be selectively deleted'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.state_sha256,NEW.export_id,NEW.original_github_user_id,
         NEW.created_at,NEW.expires_at,NEW.purpose)
     IS DISTINCT FROM
     ROW(OLD.state_sha256,OLD.export_id,OLD.original_github_user_id,
         OLD.created_at,OLD.expires_at,OLD.purpose)
     OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
  THEN
    RAISE EXCEPTION 'historical OAuth challenge is immutable except one-way consumption'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
-- Safe if a migration transaction is interrupted and retried.
DROP TRIGGER IF EXISTS boardreadyops_historical_oauth_challenge_immutable
ON public.historical_user_oauth_challenges;
CREATE TRIGGER boardreadyops_historical_oauth_challenge_immutable
BEFORE UPDATE OR DELETE ON public.historical_user_oauth_challenges
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_historical_oauth_challenge();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0122_historical_user_oauth_challenge_once')
ON CONFLICT(version) DO NOTHING;
