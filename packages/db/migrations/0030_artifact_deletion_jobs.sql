-- Durable, tenant-scoped physical artifact deletion jobs.
-- Artifact metadata can disappear immediately while object deletion remains
-- retryable, auditable, and idempotent.

create table if not exists artifact_deletion_jobs (
  id text primary key default gen_random_uuid()::text,
  artifact_id text not null unique,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  release_run_id text not null references release_runs(id) on delete cascade,
  storage_driver text not null,
  storage_path text not null,
  deletion_reason text not null,
  artifact_kind text not null,
  artifact_role text not null,
  artifact_sha256 text not null,
  artifact_bytes integer not null,
  status text not null default 'available',
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deletion_outcome text,
  last_error_class text,
  last_error_message text,
  constraint artifact_deletion_jobs_id_valid check (
    id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint artifact_deletion_jobs_artifact_id_valid check (
    artifact_id = btrim(artifact_id) and char_length(artifact_id) between 1 and 256
  ),
  constraint artifact_deletion_jobs_storage_driver_valid check (
    storage_driver = btrim(storage_driver)
    and char_length(storage_driver) between 1 and 64
    and storage_driver ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  constraint artifact_deletion_jobs_storage_path_valid check (
    storage_path = btrim(storage_path)
    and char_length(storage_path) between 1 and 1024
    and storage_path !~ '^/'
    and storage_path !~ '(^|/)\.\.(/|$)'
    and position(E'\\' in storage_path) = 0
  ),
  constraint artifact_deletion_jobs_reason_valid check (
    deletion_reason = btrim(deletion_reason) and char_length(deletion_reason) between 1 and 128
  ),
  constraint artifact_deletion_jobs_kind_valid check (
    artifact_kind = btrim(artifact_kind) and char_length(artifact_kind) between 1 and 128
  ),
  constraint artifact_deletion_jobs_role_valid check (
    artifact_role = btrim(artifact_role) and char_length(artifact_role) between 1 and 128
  ),
  constraint artifact_deletion_jobs_sha_valid check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint artifact_deletion_jobs_bytes_valid check (artifact_bytes between 0 and 2147483647),
  constraint artifact_deletion_jobs_status_valid check (status in ('available', 'leased', 'completed', 'dead_letter')),
  constraint artifact_deletion_jobs_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint artifact_deletion_jobs_lease_valid check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint artifact_deletion_jobs_completion_valid check (
    (status in ('completed', 'dead_letter') and completed_at is not null)
    or (status not in ('completed', 'dead_letter') and completed_at is null)
  ),
  constraint artifact_deletion_jobs_outcome_valid check (
    (status = 'completed' and deletion_outcome in ('deleted', 'missing'))
    or (status <> 'completed' and deletion_outcome is null)
  ),
  constraint artifact_deletion_jobs_error_valid check (
    (last_error_class is null or char_length(last_error_class) between 1 and 100)
    and (last_error_message is null or char_length(last_error_message) between 1 and 1000)
  )
);

create index if not exists artifact_deletion_jobs_claim_idx
  on artifact_deletion_jobs(available_at, created_at, id)
  where status = 'available';

create index if not exists artifact_deletion_jobs_lease_idx
  on artifact_deletion_jobs(lease_expires_at, id)
  where status = 'leased';

create index if not exists artifact_deletion_jobs_tenant_idx
  on artifact_deletion_jobs(installation_id, repository_id, created_at desc, id desc);

create index if not exists artifact_deletion_jobs_run_idx
  on artifact_deletion_jobs(release_run_id, created_at desc, id desc);

create or replace function boardreadyops_validate_artifact_deletion_job_scope()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.repositories
    where repositories.id = new.repository_id
      and repositories.installation_id = new.installation_id
  ) then
    raise exception 'artifact deletion repository does not belong to installation' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.release_runs
    where release_runs.id = new.release_run_id
      and release_runs.repository_id = new.repository_id
  ) then
    raise exception 'artifact deletion run does not belong to repository' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_deletion_jobs_validate_scope on artifact_deletion_jobs;
create trigger artifact_deletion_jobs_validate_scope
  before insert or update of installation_id, repository_id, release_run_id on artifact_deletion_jobs
  for each row execute function boardreadyops_validate_artifact_deletion_job_scope();

create or replace function boardreadyops_claim_artifact_deletions(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  deletion_job_id text,
  artifact_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  storage_driver text,
  storage_path text,
  deletion_reason text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  with expired as (
    select artifact_deletion_jobs.id,
           artifact_deletion_jobs.attempt_count,
           artifact_deletion_jobs.max_attempts
    from public.artifact_deletion_jobs
    where artifact_deletion_jobs.status = 'leased'
      and artifact_deletion_jobs.lease_expires_at <= p_now
    for update skip locked
  ), updated_expired as (
    update public.artifact_deletion_jobs
    set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
        available_at = case when expired.attempt_count >= expired.max_attempts then artifact_deletion_jobs.available_at else p_now end,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
        last_error_class = 'lease_expired',
        last_error_message = 'The artifact deletion worker lease expired before completion.'
    from expired
    where artifact_deletion_jobs.id = expired.id
    returning artifact_deletion_jobs.*
  )
  insert into public.audit_events (
    installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
    repository_id, release_run_id, metadata, created_at
  )
  select updated_expired.installation_id,
         'artifact.object.deletion_failed',
         'system',
         p_worker_id,
         'artifact',
         updated_expired.artifact_id,
         updated_expired.repository_id,
         updated_expired.release_run_id,
         jsonb_build_object(
           'reason', updated_expired.deletion_reason,
           'storageDriver', updated_expired.storage_driver,
           'attemptCount', updated_expired.attempt_count,
           'errorClass', 'lease_expired',
           'itemType', updated_expired.artifact_kind,
           'scope', updated_expired.artifact_role
         ),
         p_now
  from updated_expired
  where updated_expired.status = 'dead_letter';

  return query
  with candidates as (
    select artifact_deletion_jobs.id
    from public.artifact_deletion_jobs
    where artifact_deletion_jobs.status = 'available'
      and artifact_deletion_jobs.available_at <= p_now
    order by artifact_deletion_jobs.available_at, artifact_deletion_jobs.created_at, artifact_deletion_jobs.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.artifact_deletion_jobs
    set status = 'leased',
        attempt_count = artifact_deletion_jobs.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = p_lease_expires_at,
        completed_at = null,
        deletion_outcome = null,
        last_error_class = null,
        last_error_message = null
    from candidates
    where artifact_deletion_jobs.id = candidates.id
    returning artifact_deletion_jobs.*
  )
  select claimed.id,
         claimed.artifact_id,
         claimed.installation_id,
         claimed.repository_id,
         claimed.release_run_id,
         claimed.storage_driver,
         claimed.storage_path,
         claimed.deletion_reason,
         claimed.attempt_count
  from claimed
  order by claimed.available_at, claimed.created_at, claimed.id;
end;
$$;

create or replace function boardreadyops_complete_artifact_deletion(
  p_deletion_job_id text,
  p_worker_id text,
  p_now timestamptz,
  p_outcome text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.artifact_deletion_jobs%rowtype;
begin
  update public.artifact_deletion_jobs
  set status = 'completed',
      lease_owner = null,
      lease_expires_at = null,
      completed_at = p_now,
      deletion_outcome = p_outcome,
      last_error_class = null,
      last_error_message = null
  where artifact_deletion_jobs.id = p_deletion_job_id
    and artifact_deletion_jobs.status = 'leased'
    and artifact_deletion_jobs.lease_owner = p_worker_id
    and p_outcome in ('deleted', 'missing')
  returning artifact_deletion_jobs.* into v_job;

  if not found then return 'stale'; end if;

  insert into public.audit_events (
    installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
    repository_id, release_run_id, metadata, created_at
  ) values (
    v_job.installation_id,
    'artifact.object.deleted',
    'system',
    p_worker_id,
    'artifact',
    v_job.artifact_id,
    v_job.repository_id,
    v_job.release_run_id,
    jsonb_build_object(
      'outcome', p_outcome,
      'reason', v_job.deletion_reason,
      'storageDriver', v_job.storage_driver,
      'attemptCount', v_job.attempt_count,
      'bytes', v_job.artifact_bytes,
      'sha256', v_job.artifact_sha256,
      'itemType', v_job.artifact_kind,
      'scope', v_job.artifact_role
    ),
    p_now
  );

  return 'completed';
end;
$$;

create or replace function boardreadyops_fail_artifact_deletion(
  p_deletion_job_id text,
  p_worker_id text,
  p_now timestamptz,
  p_retry_at timestamptz,
  p_retryable boolean,
  p_error_class text,
  p_error_message text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.artifact_deletion_jobs%rowtype;
  v_outcome text;
begin
  select * into v_job
  from public.artifact_deletion_jobs
  where artifact_deletion_jobs.id = p_deletion_job_id
    and artifact_deletion_jobs.status = 'leased'
    and artifact_deletion_jobs.lease_owner = p_worker_id
  for update;

  if not found then return 'stale'; end if;

  v_outcome := case when p_retryable and v_job.attempt_count < v_job.max_attempts then 'retry' else 'dead_letter' end;

  update public.artifact_deletion_jobs
  set status = case when v_outcome = 'retry' then 'available' else 'dead_letter' end,
      available_at = case when v_outcome = 'retry' then p_retry_at else artifact_deletion_jobs.available_at end,
      lease_owner = null,
      lease_expires_at = null,
      completed_at = case when v_outcome = 'retry' then null else p_now end,
      deletion_outcome = null,
      last_error_class = left(p_error_class, 100),
      last_error_message = left(p_error_message, 1000)
  where artifact_deletion_jobs.id = p_deletion_job_id;

  if v_outcome = 'dead_letter' then
    insert into public.audit_events (
      installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
      repository_id, release_run_id, metadata, created_at
    ) values (
      v_job.installation_id,
      'artifact.object.deletion_failed',
      'system',
      p_worker_id,
      'artifact',
      v_job.artifact_id,
      v_job.repository_id,
      v_job.release_run_id,
      jsonb_build_object(
        'reason', v_job.deletion_reason,
        'storageDriver', v_job.storage_driver,
        'attemptCount', v_job.attempt_count,
        'errorClass', left(p_error_class, 100),
        'itemType', v_job.artifact_kind,
        'scope', v_job.artifact_role
      ),
      p_now
    );
  end if;

  return v_outcome;
end;
$$;
