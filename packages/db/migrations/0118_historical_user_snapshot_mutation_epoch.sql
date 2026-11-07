-- SOURCE-ONLY additive, bounded ABA detection for original USER historical
-- review, private visual, and append-only audit changes.
-- Not a full export/content lease and not a substitute for all data-class gates.
CREATE TABLE IF NOT EXISTS public.historical_user_snapshot_mutation_epochs (
  installation_id text PRIMARY KEY REFERENCES public.installations(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

-- Increment only AFTER a successfully written row. Rollbacks also roll back
-- the revision; two committed edits that restore the same content cannot
-- restore the earlier counter. No plaintext audit/PCB data enters the table.
CREATE OR REPLACE FUNCTION public.boardreadyops_bump_historical_user_snapshot_epoch(p_installation_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_installation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.installations i
     WHERE i.id=p_installation_id AND lower(i.account_type)='user'
       AND i.suspended_at IS NOT NULL
  ) THEN RETURN; END IF;
  INSERT INTO public.historical_user_snapshot_mutation_epochs (installation_id,revision)
  VALUES (p_installation_id,1)
  ON CONFLICT (installation_id)
  DO UPDATE SET revision=historical_user_snapshot_mutation_epochs.revision+1;
END;
$$;

CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_visual_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
DECLARE v_old text; v_new text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT repo.installation_id INTO v_old FROM public.release_runs run
    JOIN public.repositories repo ON repo.id=run.repository_id WHERE run.id=OLD.run_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT repo.installation_id INTO v_new FROM public.release_runs run
    JOIN public.repositories repo ON repo.id=run.repository_id WHERE run.id=NEW.run_id;
  END IF;
  IF v_old IS NOT NULL AND (v_new IS NULL OR v_old<=v_new) THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_new);
  END IF;
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old>v_new THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_visual_epoch ON public.run_snapshots;
CREATE TRIGGER boardreadyops_historical_visual_epoch
AFTER INSERT OR UPDATE OR DELETE ON public.run_snapshots
FOR EACH ROW EXECUTE FUNCTION boardreadyops_note_historical_visual_mutation();

CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_review_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
DECLARE v_old text; v_new text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT installation_id INTO v_old FROM public.repositories WHERE id=OLD.repository_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT installation_id INTO v_new FROM public.repositories WHERE id=NEW.repository_id;
  END IF;
  IF v_old IS NOT NULL AND (v_new IS NULL OR v_old<=v_new) THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_new);
  END IF;
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old>v_new THEN
    PERFORM boardreadyops_bump_historical_user_snapshot_epoch(v_old);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_review_epoch ON public.reviews;
CREATE TRIGGER boardreadyops_historical_review_epoch
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION boardreadyops_note_historical_review_mutation();

-- audit_events are append-only, so only a new committed audit event can
-- change their original-owner historical metadata.
CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_audit_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM boardreadyops_bump_historical_user_snapshot_epoch(NEW.installation_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_audit_epoch ON public.audit_events;
CREATE TRIGGER boardreadyops_historical_audit_epoch
AFTER INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION boardreadyops_note_historical_audit_epoch();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0118_historical_user_snapshot_mutation_epoch')
ON CONFLICT(version) DO NOTHING;
