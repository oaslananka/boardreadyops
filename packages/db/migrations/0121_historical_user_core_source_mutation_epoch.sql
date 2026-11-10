-- SOURCE ONLY: additive, transaction-bound original USER ABA revision tracking
-- for four source tables ACTUALLY serialized in the private partial ZIP core.
-- Scope is resolved only by authoritative FKs, never account_login or child
-- payload's actor, owner or redundant metadata.
CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_core_source_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF TG_TABLE_NAME='repositories' THEN
    IF TG_OP<>'INSERT' THEN v_old:=OLD.installation_id; END IF;
    IF TG_OP<>'DELETE' THEN v_new:=NEW.installation_id; END IF;
  ELSIF TG_TABLE_NAME='release_runs' THEN
    IF TG_OP<>'INSERT' THEN
      SELECT repo.installation_id INTO v_old
        FROM public.repositories AS repo WHERE repo.id=OLD.repository_id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT repo.installation_id INTO v_new
        FROM public.repositories AS repo WHERE repo.id=NEW.repository_id;
    END IF;
  ELSIF TG_TABLE_NAME IN ('findings','artifacts') THEN
    IF TG_OP<>'INSERT' THEN
      SELECT repo.installation_id INTO v_old
        FROM public.release_runs AS run
        JOIN public.repositories AS repo ON repo.id=run.repository_id
       WHERE run.id=OLD.run_id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT repo.installation_id INTO v_new
        FROM public.release_runs AS run
        JOIN public.repositories AS repo ON repo.id=run.repository_id
       WHERE run.id=NEW.run_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'historical core source epoch unsupported table: %',TG_TABLE_NAME;
  END IF;

  -- A cross-owner reparent must update both affected suspended original
  -- USER scopes, in deterministic key order to prevent a reverse lock cycle.
  -- The helper is SECURITY INVOKER, and skips org/active installations.
  IF v_old IS NOT NULL AND (v_new IS NULL OR v_old<=v_new) THEN
    PERFORM public.boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM public.boardreadyops_bump_historical_user_snapshot_epoch(v_new);
  END IF;
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old>v_new THEN
    PERFORM public.boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'repositories','release_runs','findings','artifacts'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS boardreadyops_historical_core_source_epoch ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER boardreadyops_historical_core_source_epoch
       AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW
       EXECUTE FUNCTION public.boardreadyops_note_historical_core_source_mutation()',
      v_table
    );
  END LOOP;
END;
$$;

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0121_historical_user_core_source_mutation_epoch')
ON CONFLICT(version) DO NOTHING;
