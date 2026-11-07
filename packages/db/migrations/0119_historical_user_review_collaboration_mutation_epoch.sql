-- SOURCE-ONLY additive historical original USER ABA protection for review
-- collaboration rows copied into the still-PARTIAL private export core.
-- Owners come from reviews -> repositories -> installations, NOT redundant
-- caller supplied repository_id or any reused GitHub account login.
CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_review_collaboration_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT repo.installation_id INTO v_old
      FROM public.reviews AS review
      JOIN public.repositories AS repo ON repo.id=review.repository_id
     WHERE review.id=OLD.review_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT repo.installation_id INTO v_new
      FROM public.reviews AS review
      JOIN public.repositories AS repo ON repo.id=review.repository_id
     WHERE review.id=NEW.review_id;
  END IF;
  -- Reparented review child must increment both old and new scopes. Order
  -- installation keys before upserts to avoid cross-tenant row-lock cycles.
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
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'review_revisions',
    'review_comments',
    'review_approvals',
    'review_checklist_items',
    'finding_decisions',
    'finding_assignments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS boardreadyops_historical_collaboration_epoch ON public.%I',v_table);
    EXECUTE format(
      'CREATE TRIGGER boardreadyops_historical_collaboration_epoch
       AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW
       EXECUTE FUNCTION public.boardreadyops_note_historical_review_collaboration_mutation()',
      v_table
    );
  END LOOP;
END;
$$;

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0119_historical_user_review_collaboration_mutation_epoch')
ON CONFLICT(version) DO NOTHING;
