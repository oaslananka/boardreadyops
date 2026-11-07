-- SOURCE ONLY / DEFAULT OFF / NO CUSTOMER DELIVERY.
-- This is proof that a one-use, original-numeric-GitHub-USER OAuth code
-- was actually exchanged successfully AFTER the hashed nonce was consumed.
-- It is NOT an authorization grant, customer ZIP readiness or download token.
-- No OAuth code, access token, raw nonce or mutable GitHub login is stored.
CREATE TABLE IF NOT EXISTS public.historical_user_live_oauth_verified_proofs (
  id uuid PRIMARY KEY,
  state_sha256 text NOT NULL UNIQUE
    REFERENCES public.historical_user_oauth_challenges(state_sha256) ON DELETE CASCADE,
  export_id text NOT NULL REFERENCES public.data_exports(id) ON DELETE CASCADE,
  original_github_user_id bigint NOT NULL CHECK (original_github_user_id > 0),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  purpose text NOT NULL DEFAULT 'private-original-user-live-oauth-proof'
    CHECK (purpose = 'private-original-user-live-oauth-proof'),
  complete_customer_export boolean NOT NULL DEFAULT false CHECK (complete_customer_export = false),
  customer_delivery_allowed boolean NOT NULL DEFAULT false CHECK (customer_delivery_allowed = false),
  CHECK (expires_at > verified_at AND expires_at <= verified_at + INTERVAL '5 minutes'),
  CHECK (revoked_at IS NULL OR revoked_at >= verified_at)
);
CREATE INDEX IF NOT EXISTS historical_user_live_oauth_verified_proofs_export_expiry
  ON public.historical_user_live_oauth_verified_proofs(export_id, original_github_user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.boardreadyops_guard_historical_live_oauth_verified_proof()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.data_exports e WHERE e.id=OLD.export_id) THEN
      RAISE EXCEPTION 'historical live OAuth proof cannot be selectively deleted'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
     AND ROW(NEW.id,NEW.state_sha256,NEW.export_id,NEW.original_github_user_id,
             NEW.verified_at,NEW.expires_at,NEW.purpose,
             NEW.complete_customer_export,NEW.customer_delivery_allowed)
      IS NOT DISTINCT FROM
         ROW(OLD.id,OLD.state_sha256,OLD.export_id,OLD.original_github_user_id,
             OLD.verified_at,OLD.expires_at,OLD.purpose,
             OLD.complete_customer_export,OLD.customer_delivery_allowed)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'historical live OAuth proof immutable except first revocation'
    USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS boardreadyops_historical_live_oauth_verified_proof_immutable
  ON public.historical_user_live_oauth_verified_proofs;
CREATE TRIGGER boardreadyops_historical_live_oauth_verified_proof_immutable
BEFORE UPDATE OR DELETE ON public.historical_user_live_oauth_verified_proofs
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_historical_live_oauth_verified_proof();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0126_historical_user_live_oauth_verified_proof')
ON CONFLICT(version) DO NOTHING;
