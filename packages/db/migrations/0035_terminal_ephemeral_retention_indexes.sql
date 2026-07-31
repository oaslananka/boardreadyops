-- Bounded terminal retention scans for one-time control-plane records.

create index if not exists runner_artifact_upload_capabilities_terminal_retention_idx
  on runner_artifact_upload_capabilities (
    (coalesce(uploaded_at, failed_at)),
    artifact_id
  )
  where status in ('uploaded', 'failed', 'expired', 'revoked');

create index if not exists runner_registration_enrollments_terminal_retention_idx
  on runner_registration_enrollments (
    (coalesce(consumed_at, revoked_at)),
    id
  )
  where consumed_at is not null or revoked_at is not null;

create index if not exists repository_setup_probes_terminal_retention_idx
  on repository_setup_probes (completed_at, id)
  where status in ('completed', 'failed', 'expired');
