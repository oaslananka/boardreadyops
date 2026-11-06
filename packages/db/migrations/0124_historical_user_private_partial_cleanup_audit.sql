-- SOURCE ONLY / CUSTOMER ZIP NO_GO. Only an already persisted immutable
-- private preflight can bind partial ZIP bytes to original numeric USER.
-- Never infer deletion authority from an unbound orphan filename.
CREATE TABLE IF NOT EXISTS public.historical_user_partial_cleanup_events (
  export_id text PRIMARY KEY REFERENCES public.data_exports(id) ON DELETE CASCADE,
  original_github_user_id bigint NOT NULL CHECK (original_github_user_id > 0),
  preflight_id uuid NOT NULL REFERENCES public.historical_user_private_delivery_preflights(id)
    ON DELETE CASCADE,
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_byte_length bigint NOT NULL CHECK (archive_byte_length BETWEEN 1 AND 67108864),
  outcome text NOT NULL CHECK (outcome IN ('deleted','missing')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  customer_delivery_allowed boolean NOT NULL DEFAULT false CHECK (customer_delivery_allowed = false)
);
CREATE INDEX IF NOT EXISTS historical_user_partial_cleanup_events_preflight
  ON public.historical_user_partial_cleanup_events(preflight_id);

CREATE OR REPLACE FUNCTION public.boardreadyops_guard_historical_partial_cleanup_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(
    SELECT 1 FROM public.data_exports e WHERE e.id=OLD.export_id
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'historical partial cleanup record is immutable while export exists'
    USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS boardreadyops_historical_partial_cleanup_immutable
ON public.historical_user_partial_cleanup_events;
CREATE TRIGGER boardreadyops_historical_partial_cleanup_immutable
BEFORE UPDATE OR DELETE ON public.historical_user_partial_cleanup_events
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_historical_partial_cleanup_event();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0124_historical_user_private_partial_cleanup_audit')
ON CONFLICT(version) DO NOTHING;
