-- Qualify runner_job_leases columns that share names with PL/pgSQL output
-- parameters. Unqualified references are ambiguous inside a RETURNS TABLE
-- function and fail closed at runtime.

create or replace function boardreadyops_heartbeat_runner_lease(
  p_now timestamptz,
  p_worker_class text,
  p_run_id text,
  p_execution_attempt_id text,
  p_lease_id text,
  p_runner_registration_id text,
  p_managed_runner_identity_id text,
  p_nonce_digest text,
  p_request_timestamp timestamptz,
  p_nonce_expires_at timestamptz,
  p_extension_expires_at timestamptz,
  p_stage text,
  p_progress_percent integer,
  p_message text,
  p_lease_token_digest text
)
returns table (
  outcome text,
  expires_at timestamptz,
  maximum_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  lease_record public.runner_job_leases%rowtype;
  nonce_id text;
  next_stage text;
begin
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
    and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
  for update of runner_job_leases;

  if not found then
    outcome := 'stale';
    return next;
    return;
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
    outcome := 'replayed';
    expires_at := lease_record.expires_at;
    maximum_expires_at := lease_record.maximum_expires_at;
    return next;
    return;
  end if;

  if lease_record.lease_token_digest <> p_lease_token_digest then
    outcome := 'stale';
    return next;
    return;
  end if;

  if lease_record.status <> 'active' or lease_record.expires_at <= p_now then
    outcome := case lease_record.status
      when 'expired' then 'expired'
      when 'revoked' then 'revoked'
      when 'completed' then 'completed'
      else 'stale'
    end;
    expires_at := lease_record.expires_at;
    maximum_expires_at := lease_record.maximum_expires_at;
    return next;
    return;
  end if;

  next_stage := case
    when case p_stage
      when 'claimed' then 0
      when 'preparing_source' then 1
      when 'running' then 2
      when 'uploading_artifacts' then 3
      when 'reporting' then 4
      else -1
    end >= case lease_record.stage
      when 'claimed' then 0
      when 'preparing_source' then 1
      when 'running' then 2
      when 'uploading_artifacts' then 3
      when 'reporting' then 4
      else 5
    end then p_stage
    else lease_record.stage
  end;

  update public.runner_job_leases
  set heartbeat_at = p_now,
      expires_at = least(runner_job_leases.maximum_expires_at, p_extension_expires_at),
      stage = next_stage,
      progress_percent = case
        when p_progress_percent is null then runner_job_leases.progress_percent
        else greatest(coalesce(runner_job_leases.progress_percent, 0), p_progress_percent)
      end,
      last_message = coalesce(p_message, runner_job_leases.last_message)
  where runner_job_leases.id = p_lease_id
  returning runner_job_leases.* into lease_record;

  update public.release_run_attempts
  set heartbeat_at = p_now,
      status = case lease_record.stage
        when 'uploading_artifacts' then 'uploading_artifacts'
        when 'reporting' then 'reporting'
        else 'in_progress'
      end
  where release_run_attempts.id = lease_record.execution_attempt_id
    and release_run_attempts.run_id = lease_record.run_id
    and release_run_attempts.status in ('in_progress', 'uploading_artifacts', 'reporting');

  if p_worker_class = 'self_hosted' then
    update public.runner_registrations
    set last_heartbeat_at = p_now
    where runner_registrations.id = p_runner_registration_id;
  else
    update public.managed_runner_identities
    set last_heartbeat_at = p_now
    where managed_runner_identities.id = p_managed_runner_identity_id;
  end if;

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
  )
  select repositories.installation_id,
         'runner.lease.renewed',
         case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
         coalesce(p_managed_runner_identity_id, p_runner_registration_id),
         'runner_lease',
         lease_record.id,
         release_runs.repository_id,
         release_runs.id,
         p_runner_registration_id,
         jsonb_build_object(
           'executionAttemptId', lease_record.execution_attempt_id,
           'stage', lease_record.stage,
           'progressPercent', lease_record.progress_percent,
           'expiresAt', lease_record.expires_at
         )
  from public.release_runs
  join public.repositories on repositories.id = release_runs.repository_id
  where release_runs.id = lease_record.run_id;

  outcome := 'active';
  expires_at := lease_record.expires_at;
  maximum_expires_at := lease_record.maximum_expires_at;
  return next;
end;
$$;
