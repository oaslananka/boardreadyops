-- Attempt-bound, single-use artifact upload capabilities for managed and self-hosted runners.
-- Plaintext capability secrets are never persisted.

create unique index if not exists runner_job_leases_id_run_attempt_idx
  on runner_job_leases(id, run_id, execution_attempt_id);

create table if not exists runner_artifact_upload_capabilities (
  artifact_id text primary key,
  run_id text not null references release_runs(id) on delete cascade,
  execution_attempt_id text not null,
  lease_id text not null,
  worker_class text not null,
  runner_registration_id text references runner_registrations(id) on delete restrict,
  managed_runner_identity_id text references managed_runner_identities(id) on delete restrict,
  kind text not null,
  name text not null,
  role text not null,
  declared_bytes integer not null,
  expected_sha256 text,
  storage_path text not null unique,
  upload_token_digest text not null,
  status text not null default 'pending',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  upload_started_at timestamptz,
  uploaded_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  constraint runner_artifact_upload_capabilities_attempt_fk
    foreign key (execution_attempt_id, run_id)
    references release_run_attempts(id, run_id)
    on delete cascade,
  constraint runner_artifact_upload_capabilities_lease_fk
    foreign key (lease_id, run_id, execution_attempt_id)
    references runner_job_leases(id, run_id, execution_attempt_id)
    on delete cascade,
  constraint runner_artifact_upload_capabilities_artifact_id_valid
    check (artifact_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint runner_artifact_upload_capabilities_worker_class_valid
    check (worker_class in ('managed', 'self_hosted')),
  constraint runner_artifact_upload_capabilities_worker_identity_valid
    check (
      (
        worker_class = 'self_hosted'
        and runner_registration_id is not null
        and managed_runner_identity_id is null
      )
      or (
        worker_class = 'managed'
        and runner_registration_id is null
        and managed_runner_identity_id is not null
      )
    ),
  constraint runner_artifact_upload_capabilities_kind_valid
    check (kind = btrim(kind) and char_length(kind) between 1 and 128),
  constraint runner_artifact_upload_capabilities_name_valid
    check (name = btrim(name) and char_length(name) between 1 and 256),
  constraint runner_artifact_upload_capabilities_role_valid
    check (role = btrim(role) and char_length(role) between 1 and 128),
  constraint runner_artifact_upload_capabilities_bytes_valid
    check (declared_bytes between 0 and 2147483647),
  constraint runner_artifact_upload_capabilities_expected_sha_valid
    check (expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$'),
  constraint runner_artifact_upload_capabilities_storage_path_valid
    check (
      storage_path = btrim(storage_path)
      and char_length(storage_path) between 1 and 1024
      and storage_path !~ '^/'
      and storage_path !~ '(^|/)\.\.(/|$)'
      and position(E'\\' in storage_path) = 0
    ),
  constraint runner_artifact_upload_capabilities_token_digest_valid
    check (upload_token_digest ~ '^[0-9a-f]{64}$'),
  constraint runner_artifact_upload_capabilities_status_valid
    check (status in ('pending', 'uploading', 'uploaded', 'failed', 'expired', 'revoked')),
  constraint runner_artifact_upload_capabilities_expiry_valid
    check (expires_at > issued_at),
  constraint runner_artifact_upload_capabilities_timestamps_valid
    check (
      (upload_started_at is null or upload_started_at >= issued_at)
      and (uploaded_at is null or uploaded_at >= issued_at)
      and (failed_at is null or failed_at >= issued_at)
    ),
  constraint runner_artifact_upload_capabilities_state_valid
    check (
      (
        status = 'pending'
        and upload_started_at is null
        and uploaded_at is null
        and failed_at is null
        and failure_reason is null
      )
      or (
        status = 'uploading'
        and upload_started_at is not null
        and uploaded_at is null
        and failed_at is null
        and failure_reason is null
      )
      or (
        status = 'uploaded'
        and upload_started_at is not null
        and uploaded_at is not null
        and failed_at is null
        and failure_reason is null
      )
      or (
        status in ('failed', 'expired', 'revoked')
        and uploaded_at is null
        and failed_at is not null
        and failure_reason is not null
      )
    ),
  constraint runner_artifact_upload_capabilities_failure_reason_valid
    check (
      failure_reason is null
      or (failure_reason = btrim(failure_reason) and char_length(failure_reason) between 1 and 1000)
    )
);

create index if not exists runner_artifact_upload_capabilities_pending_expiry_idx
  on runner_artifact_upload_capabilities(expires_at, artifact_id)
  where status = 'pending';

create index if not exists runner_artifact_upload_capabilities_lease_idx
  on runner_artifact_upload_capabilities(lease_id, issued_at desc, artifact_id);

create index if not exists runner_artifact_upload_capabilities_attempt_idx
  on runner_artifact_upload_capabilities(execution_attempt_id, issued_at desc, artifact_id);

create or replace function boardreadyops_issue_artifact_upload_capabilities(
  p_now timestamptz,
  p_worker_class text,
  p_run_id text,
  p_execution_attempt_id text,
  p_lease_id text,
  p_runner_registration_id text,
  p_managed_runner_identity_id text,
  p_lease_token_digest text,
  p_nonce_digest text,
  p_request_timestamp timestamptz,
  p_nonce_expires_at timestamptz,
  p_capabilities jsonb
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  lease_record public.runner_job_leases%rowtype;
  nonce_id text;
  capability_count integer;
  repository_id_value text;
  installation_id_value text;
begin
  if jsonb_typeof(p_capabilities) <> 'array'
    or jsonb_array_length(p_capabilities) < 1
    or jsonb_array_length(p_capabilities) > 100 then
    return 'stale';
  end if;

  select runner_job_leases.*
  into lease_record
  from public.runner_job_leases
  join public.release_runs on release_runs.id = runner_job_leases.run_id
  where runner_job_leases.id = p_lease_id
    and runner_job_leases.run_id = p_run_id
    and runner_job_leases.execution_attempt_id = p_execution_attempt_id
    and runner_job_leases.worker_class = p_worker_class
    and runner_job_leases.runner_registration_id is not distinct from p_runner_registration_id
    and runner_job_leases.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
    and runner_job_leases.lease_token_digest = p_lease_token_digest
    and runner_job_leases.status = 'active'
    and runner_job_leases.expires_at > p_now
    and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
  for update of runner_job_leases;

  if not found then
    return 'stale';
  end if;

  insert into public.runner_request_nonces (
    worker_class,
    runner_registration_id,
    managed_runner_identity_id,
    runner_job_lease_id,
    nonce_digest,
    request_timestamp,
    expires_at
  ) values (
    p_worker_class,
    p_runner_registration_id,
    p_managed_runner_identity_id,
    p_lease_id,
    p_nonce_digest,
    p_request_timestamp,
    p_nonce_expires_at
  )
  on conflict do nothing
  returning id into nonce_id;

  if nonce_id is null then
    return 'replayed';
  end if;

  insert into public.runner_artifact_upload_capabilities (
    artifact_id,
    run_id,
    execution_attempt_id,
    lease_id,
    worker_class,
    runner_registration_id,
    managed_runner_identity_id,
    kind,
    name,
    role,
    declared_bytes,
    expected_sha256,
    storage_path,
    upload_token_digest,
    issued_at,
    expires_at
  )
  select capability.artifact_id,
         p_run_id,
         p_execution_attempt_id,
         p_lease_id,
         p_worker_class,
         p_runner_registration_id,
         p_managed_runner_identity_id,
         capability.kind,
         capability.name,
         capability.role,
         capability.declared_bytes,
         capability.expected_sha256,
         capability.storage_path,
         capability.upload_token_digest,
         p_now,
         least(capability.expires_at, lease_record.expires_at)
  from jsonb_to_recordset(p_capabilities) as capability(
    artifact_id text,
    kind text,
    name text,
    role text,
    declared_bytes integer,
    expected_sha256 text,
    storage_path text,
    upload_token_digest text,
    expires_at timestamptz
  );

  get diagnostics capability_count = row_count;
  if capability_count <> jsonb_array_length(p_capabilities) then
    raise exception 'artifact capability insert count mismatch' using errcode = '23514';
  end if;

  update public.runner_job_leases
  set stage = case
        when stage in ('claimed', 'preparing_source', 'running') then 'uploading_artifacts'
        else stage
      end,
      heartbeat_at = greatest(heartbeat_at, p_now)
  where runner_job_leases.id = p_lease_id;

  update public.release_run_attempts
  set status = case
        when status = 'in_progress' then 'uploading_artifacts'
        else status
      end,
      heartbeat_at = greatest(coalesce(heartbeat_at, p_now), p_now)
  where release_run_attempts.id = p_execution_attempt_id
    and release_run_attempts.run_id = p_run_id;

  select release_runs.repository_id, repositories.installation_id
  into repository_id_value, installation_id_value
  from public.release_runs
  join public.repositories on repositories.id = release_runs.repository_id
  where release_runs.id = p_run_id;

  insert into public.audit_events (
    installation_id,
    event_type,
    actor_type,
    actor_id,
    subject_type,
    subject_id,
    repository_id,
    release_run_id,
    runner_registration_id,
    metadata
  ) values (
    installation_id_value,
    'runner.artifact.capabilities.issued',
    case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
    coalesce(p_managed_runner_identity_id, p_runner_registration_id),
    'runner_lease',
    p_lease_id,
    repository_id_value,
    p_run_id,
    p_runner_registration_id,
    jsonb_build_object(
      'executionAttemptId', p_execution_attempt_id,
      'artifactCount', capability_count
    )
  );

  return 'accepted';
end;
$$;

create or replace function boardreadyops_begin_artifact_upload(
  p_now timestamptz,
  p_artifact_id text,
  p_upload_token_digest text
)
returns table (
  outcome text,
  run_id text,
  execution_attempt_id text,
  lease_id text,
  storage_path text,
  declared_bytes integer,
  expected_sha256 text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  capability_record public.runner_artifact_upload_capabilities%rowtype;
begin
  update public.runner_artifact_upload_capabilities
  set status = 'expired',
      failed_at = p_now,
      failure_reason = 'Artifact upload capability expired before use.'
  where artifact_id = p_artifact_id
    and upload_token_digest = p_upload_token_digest
    and status = 'pending'
    and expires_at <= p_now;

  update public.runner_artifact_upload_capabilities
  set status = 'revoked',
      failed_at = p_now,
      failure_reason = 'Artifact upload capability no longer targets the current active lease.'
  where runner_artifact_upload_capabilities.artifact_id = p_artifact_id
    and runner_artifact_upload_capabilities.upload_token_digest = p_upload_token_digest
    and runner_artifact_upload_capabilities.status = 'pending'
    and not exists (
      select 1
      from public.runner_job_leases
      join public.release_runs on release_runs.id = runner_job_leases.run_id
      where runner_job_leases.id = runner_artifact_upload_capabilities.lease_id
        and runner_job_leases.run_id = runner_artifact_upload_capabilities.run_id
        and runner_job_leases.execution_attempt_id = runner_artifact_upload_capabilities.execution_attempt_id
        and runner_job_leases.status = 'active'
        and runner_job_leases.expires_at > p_now
        and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
    );

  update public.runner_artifact_upload_capabilities
  set status = 'uploading',
      upload_started_at = p_now
  where runner_artifact_upload_capabilities.artifact_id = p_artifact_id
    and runner_artifact_upload_capabilities.upload_token_digest = p_upload_token_digest
    and runner_artifact_upload_capabilities.status = 'pending'
    and runner_artifact_upload_capabilities.expires_at > p_now
    and exists (
      select 1
      from public.runner_job_leases
      join public.release_runs on release_runs.id = runner_job_leases.run_id
      where runner_job_leases.id = runner_artifact_upload_capabilities.lease_id
        and runner_job_leases.run_id = runner_artifact_upload_capabilities.run_id
        and runner_job_leases.execution_attempt_id = runner_artifact_upload_capabilities.execution_attempt_id
        and runner_job_leases.status = 'active'
        and runner_job_leases.expires_at > p_now
        and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
    )
  returning runner_artifact_upload_capabilities.* into capability_record;

  if found then
    outcome := 'accepted';
    run_id := capability_record.run_id;
    execution_attempt_id := capability_record.execution_attempt_id;
    lease_id := capability_record.lease_id;
    storage_path := capability_record.storage_path;
    declared_bytes := capability_record.declared_bytes;
    expected_sha256 := capability_record.expected_sha256;
    return next;
    return;
  end if;

  select runner_artifact_upload_capabilities.*
  into capability_record
  from public.runner_artifact_upload_capabilities
  where runner_artifact_upload_capabilities.artifact_id = p_artifact_id
    and runner_artifact_upload_capabilities.upload_token_digest = p_upload_token_digest;

  if not found then
    outcome := 'stale';
  elsif capability_record.status in ('uploading', 'uploaded') then
    outcome := 'replayed';
  elsif capability_record.status = 'expired' then
    outcome := 'expired';
  else
    outcome := 'stale';
  end if;
  return next;
end;
$$;

create or replace function boardreadyops_complete_artifact_upload(
  p_now timestamptz,
  p_artifact_id text,
  p_upload_token_digest text,
  p_actual_sha256 text,
  p_actual_bytes integer
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  capability_record public.runner_artifact_upload_capabilities%rowtype;
  repository_id_value text;
  installation_id_value text;
begin
  select runner_artifact_upload_capabilities.*
  into capability_record
  from public.runner_artifact_upload_capabilities
  where runner_artifact_upload_capabilities.artifact_id = p_artifact_id
    and runner_artifact_upload_capabilities.upload_token_digest = p_upload_token_digest
  for update;

  if not found then
    return 'stale';
  end if;

  if capability_record.status = 'uploaded' then
    if exists (
      select 1
      from public.artifacts
      where artifacts.id = p_artifact_id
        and artifacts.sha256 = p_actual_sha256
        and artifacts.bytes = p_actual_bytes
    ) then
      return 'replayed';
    end if;
    return 'stale';
  end if;

  if capability_record.status <> 'uploading' then
    return case when capability_record.status = 'expired' then 'expired' else 'stale' end;
  end if;

  if p_actual_bytes <> capability_record.declared_bytes
    or p_actual_sha256 !~ '^[0-9a-f]{64}$'
    or (
      capability_record.expected_sha256 is not null
      and capability_record.expected_sha256 <> p_actual_sha256
    ) then
    update public.runner_artifact_upload_capabilities
    set status = 'failed',
        failed_at = p_now,
        failure_reason = 'Uploaded artifact metadata does not match its declaration.'
    where artifact_id = p_artifact_id;
    return 'rejected';
  end if;

  if not exists (
    select 1
    from public.runner_job_leases
    join public.release_runs on release_runs.id = runner_job_leases.run_id
    where runner_job_leases.id = capability_record.lease_id
      and runner_job_leases.run_id = capability_record.run_id
      and runner_job_leases.execution_attempt_id = capability_record.execution_attempt_id
      and runner_job_leases.status = 'active'
      and runner_job_leases.expires_at > p_now
      and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
  ) then
    update public.runner_artifact_upload_capabilities
    set status = 'revoked',
        failed_at = p_now,
        failure_reason = 'Artifact upload completed after its attempt or lease became stale.'
    where artifact_id = p_artifact_id;
    return 'stale';
  end if;

  insert into public.artifacts (
    id,
    run_id,
    kind,
    name,
    storage_path,
    sha256,
    bytes,
    role,
    uploaded_at
  ) values (
    capability_record.artifact_id,
    capability_record.run_id,
    capability_record.kind,
    capability_record.name,
    capability_record.storage_path,
    p_actual_sha256,
    p_actual_bytes,
    capability_record.role,
    p_now
  );

  update public.runner_artifact_upload_capabilities
  set status = 'uploaded',
      uploaded_at = p_now
  where artifact_id = p_artifact_id;

  select release_runs.repository_id, repositories.installation_id
  into repository_id_value, installation_id_value
  from public.release_runs
  join public.repositories on repositories.id = release_runs.repository_id
  where release_runs.id = capability_record.run_id;

  insert into public.audit_events (
    installation_id,
    event_type,
    actor_type,
    actor_id,
    subject_type,
    subject_id,
    repository_id,
    release_run_id,
    artifact_id,
    runner_registration_id,
    metadata
  ) values (
    installation_id_value,
    'runner.artifact.uploaded',
    case when capability_record.worker_class = 'managed' then 'managed_runner' else 'runner' end,
    coalesce(capability_record.managed_runner_identity_id, capability_record.runner_registration_id),
    'artifact',
    capability_record.artifact_id,
    repository_id_value,
    capability_record.run_id,
    capability_record.artifact_id,
    capability_record.runner_registration_id,
    jsonb_build_object(
      'executionAttemptId', capability_record.execution_attempt_id,
      'leaseId', capability_record.lease_id,
      'sha256', p_actual_sha256,
      'bytes', p_actual_bytes
    )
  );

  return 'accepted';
end;
$$;

create or replace function boardreadyops_fail_artifact_upload(
  p_now timestamptz,
  p_artifact_id text,
  p_upload_token_digest text,
  p_failure_reason text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_status text;
begin
  update public.runner_artifact_upload_capabilities
  set status = 'failed',
      failed_at = p_now,
      failure_reason = p_failure_reason
  where artifact_id = p_artifact_id
    and upload_token_digest = p_upload_token_digest
    and status = 'uploading'
  returning status into current_status;

  if found then
    return 'accepted';
  end if;

  select status into current_status
  from public.runner_artifact_upload_capabilities
  where artifact_id = p_artifact_id
    and upload_token_digest = p_upload_token_digest;

  if current_status in ('failed', 'expired', 'revoked', 'uploaded') then
    return 'replayed';
  end if;
  return 'stale';
end;
$$;
