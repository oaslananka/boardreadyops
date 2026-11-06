-- SOURCE-ONLY / NO CUSTOMER DELIVERY. The historical partial ZIP private
-- verifier needs a durable, cross-worker reservation throughout disk IO.
-- There is NO timer-based release: an unresolved crashed reader blocks cleanup
-- until explicitly investigated and closed by an authorized workflow.
CREATE TABLE IF NOT EXISTS public.historical_user_partial_read_reservations (
  token uuid PRIMARY KEY,
  export_id text NOT NULL REFERENCES public.data_exports(id) ON DELETE CASCADE,
  preflight_id uuid NOT NULL REFERENCES public.historical_user_private_delivery_preflights(id)
    ON DELETE CASCADE,
  original_github_user_id bigint NOT NULL CHECK (original_github_user_id > 0),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_byte_length bigint NOT NULL CHECK (archive_byte_length BETWEEN 1 AND 67108864),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  purpose text NOT NULL DEFAULT 'private-historical-partial-zip-verification'
    CHECK (purpose = 'private-historical-partial-zip-verification'),
  customer_delivery_allowed boolean NOT NULL DEFAULT false
    CHECK (customer_delivery_allowed = false),
  CHECK (released_at IS NULL OR released_at >= started_at)
);
CREATE INDEX IF NOT EXISTS historical_user_partial_read_open_export_idx
  ON public.historical_user_partial_read_reservations(export_id)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.boardreadyops_guard_historical_partial_read_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.data_exports e WHERE e.id=OLD.export_id)
      THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'historical partial read cannot be selectively deleted'
      USING ERRCODE='23514';
  END IF;
  IF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
     AND ROW(NEW.token,NEW.export_id,NEW.preflight_id,NEW.original_github_user_id,
             NEW.archive_sha256,NEW.archive_byte_length,NEW.started_at,NEW.purpose,
             NEW.customer_delivery_allowed)
      IS NOT DISTINCT FROM
         ROW(OLD.token,OLD.export_id,OLD.preflight_id,OLD.original_github_user_id,
             OLD.archive_sha256,OLD.archive_byte_length,OLD.started_at,OLD.purpose,
             OLD.customer_delivery_allowed)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'historical partial read is immutable except first release'
    USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS boardreadyops_historical_partial_read_immutable
  ON public.historical_user_partial_read_reservations;
CREATE TRIGGER boardreadyops_historical_partial_read_immutable
BEFORE UPDATE OR DELETE ON public.historical_user_partial_read_reservations
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_historical_partial_read_reservation();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0125_historical_user_private_partial_read_reservations')
ON CONFLICT(version) DO NOTHING;
