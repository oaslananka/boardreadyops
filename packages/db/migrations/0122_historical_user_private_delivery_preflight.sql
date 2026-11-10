-- SOURCE ONLY. This is NOT a customer grant, token, download URL, or
-- authorization to publish the incomplete historical USER partial ZIP.
-- The only allowed purpose is privately testing revocation/expiry/state.
CREATE TABLE IF NOT EXISTS public.historical_user_private_delivery_preflights (
  id uuid PRIMARY KEY,
  export_id text NOT NULL UNIQUE REFERENCES public.data_exports(id) ON DELETE CASCADE,
  original_github_user_id bigint NOT NULL CHECK (original_github_user_id > 0),
  expected_archive_sha256 text NOT NULL CHECK (expected_archive_sha256 ~ '^[0-9a-f]{64}$'),
  expected_archive_bytes bigint NOT NULL CHECK (expected_archive_bytes BETWEEN 1 AND 67108864),
  expected_core_sha256 text NOT NULL CHECK (expected_core_sha256 ~ '^[0-9a-f]{64}$'),
  expected_visual_sha256 text NOT NULL CHECK (expected_visual_sha256 ~ '^[0-9a-f]{64}$'),
  expected_mutation_epoch_sha256 text NOT NULL CHECK (expected_mutation_epoch_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  customer_delivery_allowed boolean NOT NULL DEFAULT false CHECK (customer_delivery_allowed = false),
  complete_customer_export boolean NOT NULL DEFAULT false CHECK (complete_customer_export = false),
  purpose text NOT NULL DEFAULT 'private-source-only-preflight'
    CHECK (purpose = 'private-source-only-preflight'),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- Private append-only record of staged/revoked transitions. No token, IP,
-- content, actor string or customer download URL; cascade only if the
-- original export is actually removed as part of later lawful retention.
CREATE TABLE IF NOT EXISTS public.historical_user_private_preflight_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preflight_id uuid NOT NULL REFERENCES public.historical_user_private_delivery_preflights(id)
    ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('staged','revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS historical_user_private_preflight_events_by_claim
ON public.historical_user_private_preflight_events(preflight_id,created_at);

CREATE OR REPLACE FUNCTION public.boardreadyops_note_private_preflight_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  INSERT INTO public.historical_user_private_preflight_events(preflight_id,event_type)
  VALUES(NEW.id, CASE WHEN TG_OP='INSERT' THEN 'staged' ELSE 'revoked' END);
  RETURN NULL;
END;
$$;

CREATE TRIGGER boardreadyops_private_preflight_staged
AFTER INSERT ON public.historical_user_private_delivery_preflights
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_note_private_preflight_transition();
CREATE TRIGGER boardreadyops_private_preflight_revoked
AFTER UPDATE OF revoked_at ON public.historical_user_private_delivery_preflights
FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION public.boardreadyops_note_private_preflight_transition();

-- A preflight's lifecycle is append-only until its original export is
-- lawfully erased. No rewriting or selective deletion of its audit events.
CREATE OR REPLACE FUNCTION public.boardreadyops_immutable_private_preflight_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  -- Permit only lifecycle erasure cascading from a deleted parent preflight.
  -- Selective event deletion while the parent exists is forbidden.
  IF TG_OP='DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.historical_user_private_delivery_preflights p
     WHERE p.id=OLD.preflight_id
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'private preflight event is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER boardreadyops_private_preflight_event_immutable
BEFORE UPDATE OR DELETE ON public.historical_user_private_preflight_events
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_immutable_private_preflight_event();

-- No direct selective deletion: the private audit trail remains until the
-- original data-export parent is lawfully erased and cascades. Keeping this
-- guard on the preflight itself prevents deleting the parent just to make
-- its event rows disappear.
CREATE OR REPLACE FUNCTION public.boardreadyops_guard_private_preflight_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.data_exports e WHERE e.id=OLD.export_id) THEN
    RAISE EXCEPTION 'private preflight may only be erased with original export'
      USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER boardreadyops_private_preflight_delete
BEFORE DELETE ON public.historical_user_private_delivery_preflights
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_private_preflight_delete();

-- An admitted row's identity and digest may never be replaced to silently
-- switch the contents of the candidate archive after a check.
CREATE OR REPLACE FUNCTION public.boardreadyops_guard_private_delivery_preflight_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF ROW(NEW.id,NEW.export_id,NEW.original_github_user_id,NEW.expected_archive_sha256,
         NEW.expected_archive_bytes,NEW.expected_core_sha256,NEW.expected_visual_sha256,
         NEW.expected_mutation_epoch_sha256,NEW.created_at,NEW.expires_at,
         NEW.customer_delivery_allowed,NEW.complete_customer_export,NEW.purpose)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.export_id,OLD.original_github_user_id,OLD.expected_archive_sha256,
         OLD.expected_archive_bytes,OLD.expected_core_sha256,OLD.expected_visual_sha256,
         OLD.expected_mutation_epoch_sha256,OLD.created_at,OLD.expires_at,
         OLD.customer_delivery_allowed,OLD.complete_customer_export,OLD.purpose)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
  THEN
    RAISE EXCEPTION 'private preflight is immutable except one-way revocation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_private_delivery_preflight_update
ON public.historical_user_private_delivery_preflights;
CREATE TRIGGER boardreadyops_private_delivery_preflight_update
BEFORE UPDATE ON public.historical_user_private_delivery_preflights
FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_guard_private_delivery_preflight_update();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0122_historical_user_private_delivery_preflight')
ON CONFLICT(version) DO NOTHING;
