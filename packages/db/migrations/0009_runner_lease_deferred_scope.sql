-- Ordered transactional operations for the runner lease protocol.
--
-- Data-modifying CTEs share one statement snapshot. The claim path updates the
-- logical run pointer and inserts its lease in one transaction, so scope
-- validation is deferred until transaction end. The PL/pgSQL functions below
-- execute each mutation in an explicit order while remaining SECURITY INVOKER.

drop trigger if exists runner_job_leases_validate_scope on runner_job_leases;

create constraint trigger runner_job_leases_validate_scope
  after insert or update on runner_job_leases
  deferrable initially deferred
  for each row execute function boardreadyops_validate_runner_job_lease_scope();

create or replace function boardreadyops_expire_runner_leases(p_now timestamptz)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  expired_count integer;
begin
  with expired_leases as (
    update public.runner_job_leases
    set status = 'expired',
        closed_at = p_now,
        close_reason = coalesce(close_reason, 'Lease expired before a valid heartbeat renewed it.')
    where status = 'active'
      and expires_at <= p_now
    returning id, run_id, execution_attempt_id, worker_class,
              runner_registration_id, managed_runner_identity_id
  ),
  stale_attempts as (
    update public.release_run_attempts
    set status = 'stale',
        completed_at = coalesce(completed_at, p_now),
        failure_class = coalesce(failure_class, 'lease_expired'),
        failure_message = coalesce(failure_message, 'The runner lease expired before completion.')
    from expired_leases
    where release_run_attempts.id = expired_leases.execution_attempt_id
      and release_run_attempts.run_id = expired_leases.run_id
      and release_run_attempts.status in (
        'queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting'
      )
    returning release_run_attempts.id, release_run_attempts.run_id
  ),
  requeued_runs as (
    update public.release_runs
    set status = 'queued'
    from stale_attempts
    where release_runs.id = stale_attempts.run_id
      and release_runs.execution_attempt_id = stale_attempts.id
      and release_runs.status = 'running'
    returning release_runs.id
  ),
  inserted_audit as (
    insert into public.audit_events (
      installation_id, event_type, actor_type, subject_type, subject_id,
      repository_id, release_run_id, runner_registration_id, metadata
    )
    select repositories.installation_id,
           'runner.lease.expired',
           'system',
           'runner_lease',
           expired_leases.id,
           release_runs.repository_id,
           release_runs.id,
           expired_leases.runner_registration_id,
           jsonb_build_object(
             'executionAttemptId', expired_leases.execution_attempt_id,
             'workerClass', expired_leases.worker_class,
             'managedRunnerIdentityId', expired_leases.managed_runner_identity_id
           )
    from expired_leases
    join public.release_runs on release_runs.id = expired_leases.run_id
    join public.repositories on repositories.id = release_runs.repository_id
    returning id
  )
  select count(*)::integer into expired_count from expired_leases;

  return coalesce(expired_count, 0);
end;
$$;

create or replace function boardreadyops_claim_runner_job(
  p_now timestamptz,
  p_worker_class text,
  p_runner_registration_id text,
  p_managed_runner_identity_id text,
  p_capabilities jsonb,
  p_nonce_digest text,
  p_request_timestamp timestamptz,
  p_nonce_expires_at timestamptz,
  p_attempt_id text,
  p_lease_id text,
  p_lease_token_digest text,
  p_lease_expires_at timestamptz,
  p_maximum_lease_expires_at timestamptz
)
returns table (
  outcome text,
  lease_id text,
  run_id text,
  execution_attempt_id text,
  expires_at timestamptz,
  maximum_expires_at timestamptz,
  repository_owner text,
  repository_name text,
  commit_sha text,
  repository_private boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  identity_installation_id text;
  identity_allowed_repositories text[] := '{}'::text[];
  nonce_id text;
  selected_run_id text;
  selected_repository_id text;
  selected_installation_id text;
  selected_owner text;
  selected_name text;
  selected_commit_sha text;
  selected_private boolean;
  next_attempt_number integer;
begin
  if p_worker_class = 'self_hosted' then
    select runner_registrations.installation_id,
           runner_registrations.allowed_repositories
    into identity_installation_id, identity_allowed_repositories
    from public.runner_registrations
    where runner_registrations.id = p_runner_registration_id
      and p_managed_runner_identity_id is null
      and runner_registrations.status = 'active'
      and runner_registrations.disabled_at is null
      and runner_registrations.public_key is not null
      and runner_registrations.capabilities @> p_capabilities;
  elsif p_worker_class = 'managed' then
    perform 1
    from public.managed_runner_identities
    where managed_runner_identities.id = p_managed_runner_identity_id
      and p_runner_registration_id is null
      and managed_runner_identities.status = 'active'
      and managed_runner_identities.disabled_at is null
      and managed_runner_identities.capabilities @> p_capabilities;
  else
    outcome := 'empty';
    return next;
    return;
  end if;

  if not found then
    outcome := 'empty';
    return next;
    return;
  end if;

  insert into public.runner_request_nonces (
    worker_class,
    runner_registration_id,
    managed_runner_identity_id,
    nonce_digest,
    request_timestamp,
    expires_at
  ) values (
    p_worker_class,
    p_runner_registration_id,
    p_managed_runner_identity_id,
    p_nonce_digest,
    p_request_timestamp,
    p_nonce_expires_at
  )
  on conflict do nothing
  returning id into nonce_id;

  if nonce_id is null then
    outcome := 'replayed';
    return next;
    return;
  end if;

  select release_runs.id,
         release_runs.repository_id,
         release_runs.commit_sha,
         repositories.installation_id,
         repositories.owner,
         repositories.name,
         repositories.private
  into selected_run_id,
       selected_repository_id,
       selected_commit_sha,
       selected_installation_id,
       selected_owner,
       selected_name,
       selected_private
  from public.release_runs
  join public.repositories on repositories.id = release_runs.repository_id
  join public.installations on installations.id = repositories.installation_id
  left join public.release_run_attempts current_attempt
    on current_attempt.id = release_runs.execution_attempt_id
  where release_runs.status in ('queued', 'running')
    and repositories.disabled_at is null
    and installations.suspended_at is null
    and (
      release_runs.execution_attempt_id is null
      or current_attempt.status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
    )
    and (
      p_worker_class = 'managed'
      or (
        repositories.installation_id = identity_installation_id
        and (
          cardinality(identity_allowed_repositories) = 0
          or exists (
            select 1
            from unnest(identity_allowed_repositories) allowed_repository
            where lower(allowed_repository) = lower(repositories.owner || '/' || repositories.name)
          )
        )
      )
    )
  order by release_runs.started_at, release_runs.id
  for update of release_runs skip locked
  limit 1;

  if not found then
    outcome := 'empty';
    return next;
    return;
  end if;

  select coalesce(max(release_run_attempts.attempt_number), 0) + 1
  into next_attempt_number
  from public.release_run_attempts
  where release_run_attempts.run_id = selected_run_id;

  insert into public.release_run_attempts (
    id,
    run_id,
    attempt_number,
    status,
    created_at,
    dispatch_requested_at,
    dispatched_at,
    started_at,
    heartbeat_at
  ) values (
    p_attempt_id,
    selected_run_id,
    next_attempt_number,
    'in_progress',
    p_now,
    p_now,
    p_now,
    p_now,
    p_now
  );

  update public.release_runs
  set execution_attempt_id = p_attempt_id,
      execution_attempt_started_at = p_now,
      status = 'running'
  where release_runs.id = selected_run_id;

  insert into public.runner_job_leases (
    id,
    run_id,
    execution_attempt_id,
    worker_class,
    runner_registration_id,
    managed_runner_identity_id,
    lease_token_digest,
    status,
    stage,
    claimed_at,
    heartbeat_at,
    expires_at,
    maximum_expires_at
  ) values (
    p_lease_id,
    selected_run_id,
    p_attempt_id,
    p_worker_class,
    p_runner_registration_id,
    p_managed_runner_identity_id,
    p_lease_token_digest,
    'active',
    'claimed',
    p_now,
    p_now,
    p_lease_expires_at,
    p_maximum_lease_expires_at
  );

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
  ) values (
    selected_installation_id,
    'runner.lease.claimed',
    case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
    coalesce(p_managed_runner_identity_id, p_runner_registration_id),
    'runner_lease',
    p_lease_id,
    selected_repository_id,
    selected_run_id,
    p_runner_registration_id,
    jsonb_build_object(
      'executionAttemptId', p_attempt_id,
      'workerClass', p_worker_class,
      'expiresAt', p_lease_expires_at,
      'maximumExpiresAt', p_maximum_lease_expires_at
    )
  );

  outcome := 'claimed';
  lease_id := p_lease_id;
  run_id := selected_run_id;
  execution_attempt_id := p_attempt_id;
  expires_at := p_lease_expires_at;
  maximum_expires_at := p_maximum_lease_expires_at;
  repository_owner := selected_owner;
  repository_name := selected_name;
  commit_sha := selected_commit_sha;
  repository_private := selected_private;
  return next;
end;
$$;

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
      expires_at = least(maximum_expires_at, p_extension_expires_at),
      stage = next_stage,
      progress_percent = case
        when p_progress_percent is null then progress_percent
        else greatest(coalesce(progress_percent, 0), p_progress_percent)
      end,
      last_message = coalesce(p_message, last_message)
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

create or replace function boardreadyops_relinquish_runner_lease(
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
  p_message text,
  p_default_message text,
  p_lease_token_digest text,
  p_attempt_status text,
  p_reason text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  lease_record public.runner_job_leases%rowtype;
  nonce_id text;
begin
  select runner_job_leases.*
  into lease_record
  from public.runner_job_leases
  where runner_job_leases.id = p_lease_id
    and runner_job_leases.run_id = p_run_id
    and runner_job_leases.execution_attempt_id = p_execution_attempt_id
    and runner_job_leases.worker_class = p_worker_class
    and runner_job_leases.runner_registration_id is not distinct from p_runner_registration_id
    and runner_job_leases.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
  for update;

  if not found or lease_record.lease_token_digest <> p_lease_token_digest then
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

  if nonce_id is null or lease_record.status = 'relinquished' then
    return 'replayed';
  end if;

  if lease_record.status <> 'active' or lease_record.expires_at <= p_now then
    return 'stale';
  end if;

  update public.runner_job_leases
  set status = 'relinquished',
      closed_at = p_now,
      close_reason = coalesce(p_message, p_default_message)
  where runner_job_leases.id = p_lease_id;

  update public.release_run_attempts
  set status = p_attempt_status,
      completed_at = coalesce(completed_at, p_now),
      failure_class = coalesce(failure_class, 'runner_relinquished'),
      failure_message = coalesce(failure_message, p_default_message)
  where release_run_attempts.id = p_execution_attempt_id
    and release_run_attempts.run_id = p_run_id
    and release_run_attempts.status in ('in_progress', 'uploading_artifacts', 'reporting');

  update public.release_runs
  set status = 'queued'
  where release_runs.id = p_run_id
    and release_runs.execution_attempt_id = p_execution_attempt_id
    and release_runs.status = 'running';

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
         'runner.lease.relinquished',
         case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
         coalesce(p_managed_runner_identity_id, p_runner_registration_id),
         'runner_lease',
         p_lease_id,
         release_runs.repository_id,
         release_runs.id,
         p_runner_registration_id,
         jsonb_build_object(
           'executionAttemptId', p_execution_attempt_id,
           'reason', p_reason,
           'attemptStatus', p_attempt_status
         )
  from public.release_runs
  join public.repositories on repositories.id = release_runs.repository_id
  where release_runs.id = p_run_id;

  return 'accepted';
end;
$$;
