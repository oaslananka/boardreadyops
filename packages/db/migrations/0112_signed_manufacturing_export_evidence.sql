-- A source-bound manufacturing export is independent of the ordinary runner result.
-- It is tenant/run/attempt bound and cannot authorize a share on its own.

CREATE TABLE IF NOT EXISTS public.signed_manufacturing_export_evidence (
  run_id text NOT NULL REFERENCES public.release_runs(id) ON DELETE CASCADE,
  execution_attempt_id text NOT NULL,
  repository_id text NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  installation_id text NOT NULL REFERENCES public.installations(id) ON DELETE CASCADE,
  artifact_id text NOT NULL UNIQUE REFERENCES public.artifacts(id) ON DELETE CASCADE,
  github_repository_id bigint NOT NULL,
  github_run_id text NOT NULL,
  -- GitHub's OIDC run_attempt (not BoardReadyOps release_run_attempts.attempt_number).
  run_attempt integer NOT NULL,
  source_sha text NOT NULL,
  signer_sha text NOT NULL,
  source_ref text NOT NULL,
  workflow_path text NOT NULL,
  manifest_sha256 text NOT NULL,
  bundle_sha256 text NOT NULL,
  subject_count integer NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, execution_attempt_id),
  FOREIGN KEY (execution_attempt_id, run_id)
    REFERENCES public.release_run_attempts(id, run_id) ON DELETE CASCADE,
  CONSTRAINT signed_export_github_repo_id_valid CHECK (github_repository_id > 0),
  CONSTRAINT signed_export_github_run_id_valid CHECK (github_run_id ~ '^[1-9][0-9]{0,19}$'),
  CONSTRAINT signed_export_run_attempt_valid CHECK (run_attempt > 0),
  CONSTRAINT signed_export_source_sha_valid CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT signed_export_signer_sha_valid CHECK (signer_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT signed_export_source_ref_valid CHECK (source_ref ~ '^refs/heads/[^[:cntrl:]]{1,240}$'),
  CONSTRAINT signed_export_workflow_path_valid CHECK (
    workflow_path ~ '^\.github/workflows/[A-Za-z0-9_.-]{1,128}\.ya?ml$'
  ),
  CONSTRAINT signed_export_manifest_digest_valid CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signed_export_bundle_digest_valid CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signed_export_subject_count_valid CHECK (subject_count BETWEEN 1 AND 1024)
);

CREATE INDEX IF NOT EXISTS signed_manufacturing_export_evidence_tenant_idx
  ON public.signed_manufacturing_export_evidence(installation_id, repository_id, verified_at DESC);

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0112_signed_manufacturing_export_evidence')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.boardreadyops_record_signed_manufacturing_export(
  p_now timestamptz,
  p_run_id text,
  p_execution_attempt_id text,
  p_artifact_id text,
  p_storage_path text,
  p_archive_sha256 text,
  p_archive_bytes integer,
  p_source_sha text,
  p_signer_sha text,
  p_github_repository_id bigint,
  p_github_run_id text,
  p_run_attempt integer,
  p_source_ref text,
  p_workflow_path text,
  p_manifest_sha256 text,
  p_bundle_sha256 text,
  p_subject_count integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_record public.release_runs%rowtype;
  attempt_record public.release_run_attempts%rowtype;
  repository_record public.repositories%rowtype;
BEGIN
  IF p_archive_sha256 !~ '^[0-9a-f]{64}$'
    OR p_archive_bytes <= 0
    OR p_source_sha !~ '^[0-9a-f]{40}$'
    OR p_signer_sha !~ '^[0-9a-f]{40}$'
    OR p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    OR p_bundle_sha256 !~ '^[0-9a-f]{64}$'
    OR p_subject_count < 1 OR p_subject_count > 1024 THEN
    RETURN 'stale';
  END IF;

  SELECT * INTO run_record
    FROM public.release_runs
   WHERE id = p_run_id
   FOR UPDATE;
  IF NOT FOUND OR run_record.execution_attempt_id IS DISTINCT FROM p_execution_attempt_id
    OR run_record.commit_sha IS DISTINCT FROM p_source_sha
    OR run_record.status NOT IN ('dispatched', 'running') THEN
    RETURN 'stale';
  END IF;

  SELECT * INTO attempt_record
    FROM public.release_run_attempts
   WHERE id = p_execution_attempt_id AND run_id = p_run_id
   FOR UPDATE;
  IF NOT FOUND
    OR attempt_record.status NOT IN ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting')
    OR p_run_attempt <> 1
    OR attempt_record.github_workflow_dispatch_id IS DISTINCT FROM p_github_run_id THEN
    RETURN 'stale';
  END IF;

  SELECT * INTO repository_record
    FROM public.repositories
   WHERE id = run_record.repository_id;
  IF NOT FOUND
    OR repository_record.github_repo_id::bigint <> p_github_repository_id THEN
    RETURN 'stale';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.signed_manufacturing_export_evidence
     WHERE execution_attempt_id = p_execution_attempt_id OR artifact_id = p_artifact_id
  ) THEN
    RETURN 'replayed';
  END IF;

  INSERT INTO public.artifacts (
    id, run_id, execution_attempt_id, content_type, kind, name,
    storage_path, sha256, bytes, role, uploaded_at
  ) VALUES (
    p_artifact_id, p_run_id, p_execution_attempt_id, 'application/gzip', 'archive',
    'signed-manufacturing-export.tar.gz', p_storage_path, p_archive_sha256,
    p_archive_bytes, 'manufacturing', p_now
  );

  INSERT INTO public.signed_manufacturing_export_evidence (
    run_id, execution_attempt_id, repository_id, installation_id, artifact_id,
    github_repository_id, github_run_id, run_attempt, source_sha, signer_sha,
    source_ref, workflow_path, manifest_sha256, bundle_sha256, subject_count, verified_at
  ) VALUES (
    p_run_id, p_execution_attempt_id, repository_record.id, repository_record.installation_id, p_artifact_id,
    p_github_repository_id, p_github_run_id, p_run_attempt, p_source_sha, p_signer_sha,
    p_source_ref, p_workflow_path, p_manifest_sha256, p_bundle_sha256, p_subject_count, p_now
  );

  INSERT INTO public.audit_events (
    installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
    repository_id, release_run_id, artifact_id, metadata
  ) VALUES (
    repository_record.installation_id, 'manufacturing.export.attested', 'github_actions',
    p_github_run_id, 'artifact', p_artifact_id, repository_record.id, p_run_id, p_artifact_id,
    jsonb_build_object(
      'executionAttemptId', p_execution_attempt_id,
      'sourceSha', p_source_sha,
      'signerSha', p_signer_sha,
      'runAttempt', p_run_attempt,
      'manifestSha256', p_manifest_sha256,
      'bundleSha256', p_bundle_sha256,
      'subjectCount', p_subject_count,
      'archiveSha256', p_archive_sha256,
      'archiveBytes', p_archive_bytes
    )
  );

  RETURN 'accepted';
END;
$$;


CREATE OR REPLACE FUNCTION public.boardreadyops_reject_signed_manufacturing_export_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'signed manufacturing export evidence is immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS signed_manufacturing_export_evidence_immutable
  ON public.signed_manufacturing_export_evidence;
CREATE TRIGGER signed_manufacturing_export_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.signed_manufacturing_export_evidence
  FOR EACH ROW EXECUTE FUNCTION public.boardreadyops_reject_signed_manufacturing_export_evidence_mutation();
