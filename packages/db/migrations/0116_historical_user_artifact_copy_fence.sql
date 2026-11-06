-- Internal historical USER artifact read reservation. No HTTP authorization,
-- worker scheduling, downloadable ZIP, or retention override.
-- Reuse the durable copy reservation and the existing cross-tenant path lock
-- so a physical unlink cannot race an authorized filesystem read.
CREATE OR REPLACE FUNCTION boardreadyops_begin_historical_user_artifact_copy(
  p_export_id text, p_verified_user_id bigint, p_artifact_id text,
  p_expected_path text, p_expected_sha256 text, p_expected_bytes integer,
  p_reader_id uuid, p_reservation uuid
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant text;
  v_path text;
  v_current_tenant text;
  v_current_path text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'historical export copy admission requires read committed isolation'
      USING errcode='B4402';
  END IF;
  IF p_verified_user_id IS NULL OR p_verified_user_id <= 0
    OR p_expected_path IS NULL OR char_length(p_expected_path) NOT BETWEEN 1 AND 1024
    OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_bytes IS NULL OR p_expected_bytes NOT BETWEEN 0 AND 67108864
    OR p_reader_id IS NULL OR p_reservation IS NULL
  THEN RETURN 'stale'; END IF;

  -- The first lookup supplies only lock keys; repeat authority under locks.
  SELECT lower(e.tenant_id), a.storage_path INTO v_tenant, v_path
    FROM public.data_exports AS e
    JOIN public.installations AS i
      ON i.account_user_id=e.original_github_user_id
      AND lower(i.account_login)=lower(e.tenant_id)
      AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
    JOIN public.repositories AS repo ON repo.installation_id=i.id
    JOIN public.release_runs AS run ON run.repository_id=repo.id
    JOIN public.artifacts AS a ON a.run_id=run.id
   WHERE e.id=p_export_id AND e.original_github_user_id=p_verified_user_id
     AND e.scope='user' AND e.installation_id IS NULL
     AND lower(e.scope_id)=lower(e.tenant_id)
     AND e.requested_by='github_app_uninstall' AND e.status='pending'
     AND a.id=p_artifact_id AND a.storage_path=p_expected_path
     AND a.sha256=p_expected_sha256 AND a.bytes=p_expected_bytes
     AND a.retention_until IS NOT NULL AND a.retention_until>clock_timestamp()
     AND NOT EXISTS (
       SELECT 1 FROM public.erasure_requests AS er
        WHERE lower(er.tenant_id)=lower(e.tenant_id)
          AND er.status='completed' AND er.dry_run=FALSE
          AND (er.scope='organization'
            OR (er.scope='user' AND lower(er.scope_id)=lower(e.scope_id)))
     );
  IF v_tenant IS NULL OR v_path IS DISTINCT FROM p_expected_path THEN
    RETURN 'stale';
  END IF;

  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_tenant));
  PERFORM pg_advisory_xact_lock(boardreadyops_artifact_path_lock_key(v_path));

  SELECT lower(e.tenant_id), a.storage_path INTO v_current_tenant, v_current_path
    FROM public.data_exports AS e
    JOIN public.installations AS i
      ON i.account_user_id=e.original_github_user_id
      AND lower(i.account_login)=lower(e.tenant_id)
      AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
    JOIN public.repositories AS repo ON repo.installation_id=i.id
    JOIN public.release_runs AS run ON run.repository_id=repo.id
    JOIN public.artifacts AS a ON a.run_id=run.id
   WHERE e.id=p_export_id AND e.original_github_user_id=p_verified_user_id
     AND e.scope='user' AND e.installation_id IS NULL
     AND lower(e.scope_id)=lower(e.tenant_id)
     AND e.requested_by='github_app_uninstall' AND e.status='pending'
     AND a.id=p_artifact_id AND a.storage_path=p_expected_path
     AND a.sha256=p_expected_sha256 AND a.bytes=p_expected_bytes
     AND a.retention_until IS NOT NULL AND a.retention_until>clock_timestamp()
     AND NOT EXISTS (
       SELECT 1 FROM public.erasure_requests AS er
        WHERE lower(er.tenant_id)=lower(e.tenant_id)
          AND er.status='completed' AND er.dry_run=FALSE
          AND (er.scope='organization'
            OR (er.scope='user' AND lower(er.scope_id)=lower(e.scope_id)))
     );
  IF v_current_tenant IS DISTINCT FROM v_tenant
    OR v_current_path IS DISTINCT FROM v_path
  THEN RETURN 'stale'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.artifact_deletion_jobs AS job
     WHERE job.storage_path=v_path
  ) OR EXISTS (
    SELECT 1 FROM public.artifact_unlink_fences AS f
    JOIN public.artifact_deletion_jobs AS job ON job.id=f.deletion_job_id
    WHERE f.settled_at IS NULL AND job.storage_path=v_path
  ) OR EXISTS (
    SELECT 1 FROM public.artifact_export_copy_reservations AS reservation
     WHERE reservation.export_id=p_export_id AND reservation.artifact_id=p_artifact_id
       AND reservation.released_at IS NULL
  ) THEN RETURN 'stale'; END IF;

  INSERT INTO public.artifact_export_copy_reservations
    (token,export_id,artifact_id,tenant_key,storage_path,worker_id)
  VALUES
    (p_reservation,p_export_id,p_artifact_id,v_tenant,v_path,
     'historical-user:' || p_reader_id::text);
  RETURN 'reserved';
END;
$$;

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0116_historical_user_artifact_copy_fence')
ON CONFLICT(version) DO NOTHING;
