-- Provider-neutral artifact metadata required by the evidence viewer contract.
-- This migration does not select or configure an object-storage provider.

alter table artifacts
  add column if not exists execution_attempt_id text,
  add column if not exists content_type text not null default 'application/octet-stream',
  add column if not exists retention_until timestamptz;

update artifacts
set execution_attempt_id = capability.execution_attempt_id
from runner_artifact_upload_capabilities as capability
where artifacts.execution_attempt_id is null
  and capability.artifact_id = artifacts.id
  and capability.run_id = artifacts.run_id;

update artifacts
set execution_attempt_id = result.execution_attempt_id
from release_run_results as result
where artifacts.execution_attempt_id is null
  and result.run_id = artifacts.run_id
  and result.execution_attempt_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'artifacts_execution_attempt_fk'
  ) then
    alter table artifacts
      add constraint artifacts_execution_attempt_fk
      foreign key (execution_attempt_id, run_id)
      references release_run_attempts(id, run_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'artifacts_content_type_valid'
  ) then
    alter table artifacts
      add constraint artifacts_content_type_valid
      check (
        content_type = lower(btrim(content_type))
        and char_length(content_type) between 3 and 255
        and content_type ~ '^[a-z0-9][a-z0-9!#$%&*+.^_~-]*/[a-z0-9][a-z0-9!#$%&*+.^_~-]*$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'artifacts_retention_until_valid'
  ) then
    alter table artifacts
      add constraint artifacts_retention_until_valid
      check (retention_until is null or retention_until >= uploaded_at);
  end if;
end;
$$;

create index if not exists artifacts_execution_attempt_idx
  on artifacts(execution_attempt_id, uploaded_at desc, id)
  where execution_attempt_id is not null;

alter table runner_artifact_upload_capabilities
  add column if not exists content_type text not null default 'application/octet-stream';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runner_artifact_upload_capabilities_content_type_valid'
  ) then
    alter table runner_artifact_upload_capabilities
      add constraint runner_artifact_upload_capabilities_content_type_valid
      check (
        content_type = lower(btrim(content_type))
        and char_length(content_type) between 3 and 255
        and content_type ~ '^[a-z0-9][a-z0-9!#$%&*+.^_~-]*/[a-z0-9][a-z0-9!#$%&*+.^_~-]*$'
      );
  end if;
end;
$$;

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
    content_type,
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
         coalesce(capability.content_type, 'application/octet-stream'),
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
    content_type text,
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
    execution_attempt_id,
    content_type,
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
    capability_record.execution_attempt_id,
    capability_record.content_type,
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
