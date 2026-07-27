-- Bind runner leases to optimistic-concurrency snapshots of the authoritative
-- logical run and execution attempt. The public runner protocol function
-- signatures remain unchanged.

alter table runner_job_leases
  add column if not exists expected_run_status text,
  add column if not exists expected_run_version bigint,
  add column if not exists expected_attempt_status text,
  add column if not exists expected_attempt_version bigint;

update runner_job_leases
   set expected_run_status = release_runs.status,
       expected_run_version = release_runs.version,
       expected_attempt_status = release_run_attempts.status,
       expected_attempt_version = release_run_attempts.version
  from release_runs
  join release_run_attempts
    on release_run_attempts.run_id = release_runs.id
 where runner_job_leases.run_id = release_runs.id
   and runner_job_leases.execution_attempt_id = release_run_attempts.id
   and (
     runner_job_leases.expected_run_status is null
     or runner_job_leases.expected_run_version is null
     or runner_job_leases.expected_attempt_status is null
     or runner_job_leases.expected_attempt_version is null
   );

alter table runner_job_leases
  alter column expected_run_status set not null,
  alter column expected_run_version set not null,
  alter column expected_attempt_status set not null,
  alter column expected_attempt_version set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runner_job_leases_expected_run_version_valid'
  ) then
    alter table runner_job_leases
      add constraint runner_job_leases_expected_run_version_valid
      check (expected_run_version >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'runner_job_leases_expected_attempt_version_valid'
  ) then
    alter table runner_job_leases
      add constraint runner_job_leases_expected_attempt_version_valid
      check (expected_attempt_version >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'runner_job_leases_expected_status_valid'
  ) then
    alter table runner_job_leases
      add constraint runner_job_leases_expected_status_valid
      check (
        expected_run_status in (
          'queued', 'dispatched', 'running', 'completed', 'failed', 'timed_out', 'cancelled', 'superseded'
        )
        and expected_attempt_status in (
          'queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting',
          'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
        )
      );
  end if;
end;
$$;

-- A runner relinquish or lease expiry is a bounded retry implemented only
-- inside the guarded lease functions below. The general transition graph stays
-- strict so callers cannot requeue a running logical run without atomically
-- terminalizing its current execution attempt.

create or replace function boardreadyops_expire_runner_leases(p_now timestamptz)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  run_record public.release_runs%rowtype;
  attempt_record public.release_run_attempts%rowtype;
  lease_record public.runner_job_leases%rowtype;
  installation_id text;
  repository_id text;
  lifecycle_binding_valid boolean;
  next_run_version bigint;
  next_attempt_version bigint;
  expired_count integer := 0;
begin
  for candidate in
    select runner_job_leases.id,
           runner_job_leases.run_id,
           runner_job_leases.execution_attempt_id
      from public.runner_job_leases
     where runner_job_leases.status = 'active'
       and runner_job_leases.expires_at <= p_now
     order by runner_job_leases.expires_at, runner_job_leases.id
  loop
    select release_runs.*
      into run_record
      from public.release_runs
     where release_runs.id = candidate.run_id
     for update of release_runs;

    if run_record.id is null then
      continue;
    end if;

    select release_run_attempts.*
      into attempt_record
      from public.release_run_attempts
     where release_run_attempts.id = candidate.execution_attempt_id
       and release_run_attempts.run_id = candidate.run_id
     for update of release_run_attempts;

    if attempt_record.id is null then
      continue;
    end if;

    select runner_job_leases.*
      into lease_record
      from public.runner_job_leases
     where runner_job_leases.id = candidate.id
       and runner_job_leases.run_id = candidate.run_id
       and runner_job_leases.execution_attempt_id = candidate.execution_attempt_id
       and runner_job_leases.status = 'active'
       and runner_job_leases.expires_at <= p_now
     for update of runner_job_leases;

    if lease_record.id is null then
      continue;
    end if;

    select repositories.installation_id, repositories.id
      into installation_id, repository_id
      from public.repositories
     where repositories.id = run_record.repository_id;

    lifecycle_binding_valid :=
      run_record.execution_attempt_id is not distinct from lease_record.execution_attempt_id
      and run_record.status is not distinct from lease_record.expected_run_status
      and run_record.version is not distinct from lease_record.expected_run_version
      and attempt_record.status is not distinct from lease_record.expected_attempt_status
      and attempt_record.version is not distinct from lease_record.expected_attempt_version
      and run_record.status = 'running'
      and boardreadyops_release_run_attempt_transition_allowed(attempt_record.status, 'stale');

    next_run_version := run_record.version;
    next_attempt_version := attempt_record.version;

    if lifecycle_binding_valid then
      update public.release_run_attempts
         set status = 'stale',
             version = release_run_attempts.version + 1,
             completed_at = coalesce(release_run_attempts.completed_at, p_now),
             failure_class = coalesce(release_run_attempts.failure_class, 'lease_expired'),
             failure_message = coalesce(
               release_run_attempts.failure_message,
               'The runner lease expired before completion.'
             )
       where release_run_attempts.id = lease_record.execution_attempt_id
         and release_run_attempts.run_id = lease_record.run_id
         and release_run_attempts.status = lease_record.expected_attempt_status
         and release_run_attempts.version = lease_record.expected_attempt_version
      returning release_run_attempts.version into next_attempt_version;

      if next_attempt_version is null then
        raise exception 'runner lease expiry attempt changed after it was locked'
          using errcode = '40001';
      end if;

      update public.release_runs
         set status = 'queued',
             version = release_runs.version + 1
       where release_runs.id = lease_record.run_id
         and release_runs.execution_attempt_id = lease_record.execution_attempt_id
         and release_runs.status = lease_record.expected_run_status
         and release_runs.version = lease_record.expected_run_version
      returning release_runs.version into next_run_version;

      if next_run_version is null then
        raise exception 'runner lease expiry run changed after it was locked'
          using errcode = '40001';
      end if;

      insert into public.release_run_transition_events (
        installation_id, repository_id, release_run_id, execution_attempt_id,
        entity_type, from_status, to_status, from_version, to_version,
        reason_code, occurred_at
      ) values (
        installation_id, repository_id, lease_record.run_id, null,
        'release_run', run_record.status, 'queued', run_record.version, next_run_version,
        'runner_lease_expired', p_now
      );

      insert into public.release_run_transition_events (
        installation_id, repository_id, release_run_id, execution_attempt_id,
        entity_type, from_status, to_status, from_version, to_version,
        reason_code, occurred_at
      ) values (
        installation_id, repository_id, lease_record.run_id, lease_record.execution_attempt_id,
        'execution_attempt', attempt_record.status, 'stale', attempt_record.version, next_attempt_version,
        'runner_lease_expired', p_now
      );
    end if;

    update public.runner_job_leases
       set status = 'expired',
           closed_at = p_now,
           close_reason = coalesce(
             runner_job_leases.close_reason,
             'Lease expired before a valid heartbeat renewed it.'
           ),
           expected_run_status = case
             when lifecycle_binding_valid then 'queued'
             else runner_job_leases.expected_run_status
           end,
           expected_run_version = case
             when lifecycle_binding_valid then next_run_version
             else runner_job_leases.expected_run_version
           end,
           expected_attempt_status = case
             when lifecycle_binding_valid then 'stale'
             else runner_job_leases.expected_attempt_status
           end,
           expected_attempt_version = case
             when lifecycle_binding_valid then next_attempt_version
             else runner_job_leases.expected_attempt_version
           end
     where runner_job_leases.id = lease_record.id;

    insert into public.audit_events (
      installation_id, event_type, actor_type, subject_type, subject_id,
      repository_id, release_run_id, runner_registration_id, metadata
    ) values (
      installation_id,
      'runner.lease.expired',
      'system',
      'runner_lease',
      lease_record.id,
      repository_id,
      lease_record.run_id,
      lease_record.runner_registration_id,
      jsonb_build_object(
        'executionAttemptId', lease_record.execution_attempt_id,
        'workerClass', lease_record.worker_class,
        'managedRunnerIdentityId', lease_record.managed_runner_identity_id,
        'lifecycleBindingValid', lifecycle_binding_valid
      )
    );

    expired_count := expired_count + 1;
  end loop;

  return expired_count;
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
  selected_policy_mode text;
  selected_policy_source text;
  selected_offline_after_seconds integer;
  selected_fallback_reason text;
  selected_run_status text;
  selected_run_version bigint;
  selected_current_attempt_id text;
  selected_next_run_version bigint;
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
    worker_class, runner_registration_id, managed_runner_identity_id,
    nonce_digest, request_timestamp, expires_at
  ) values (
    p_worker_class, p_runner_registration_id, p_managed_runner_identity_id,
    p_nonce_digest, p_request_timestamp, p_nonce_expires_at
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
         repositories.private,
         effective_policy.policy_mode,
         effective_policy.policy_source,
         effective_policy.self_hosted_offline_after_seconds,
         release_runs.status,
         release_runs.version,
         release_runs.execution_attempt_id
    into selected_run_id,
         selected_repository_id,
         selected_commit_sha,
         selected_installation_id,
         selected_owner,
         selected_name,
         selected_private,
         selected_policy_mode,
         selected_policy_source,
         selected_offline_after_seconds,
         selected_run_status,
         selected_run_version,
         selected_current_attempt_id
    from public.release_runs
    join public.repositories on repositories.id = release_runs.repository_id
    join public.installations on installations.id = repositories.installation_id
    join lateral public.boardreadyops_effective_runner_policy(
      repositories.installation_id,
      repositories.id
    ) effective_policy on true
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
       (
         p_worker_class = 'self_hosted'
         and effective_policy.policy_mode in ('self_hosted_required', 'self_hosted_preferred')
         and repositories.installation_id = identity_installation_id
         and (
           cardinality(identity_allowed_repositories) = 0
           or exists (
             select 1
               from unnest(identity_allowed_repositories) allowed_repository
              where lower(allowed_repository) = lower(repositories.owner || '/' || repositories.name)
           )
         )
       )
       or (
         p_worker_class = 'managed'
         and (
           effective_policy.policy_mode = 'managed_only'
           or (
             effective_policy.policy_mode = 'self_hosted_preferred'
             and not exists (
               select 1
                 from public.runner_registrations eligible_runner
                where eligible_runner.installation_id = repositories.installation_id
                  and eligible_runner.status = 'active'
                  and eligible_runner.disabled_at is null
                  and eligible_runner.public_key is not null
                  and eligible_runner.last_heartbeat_at is not null
                  and eligible_runner.last_heartbeat_at > p_now - make_interval(
                    secs => effective_policy.self_hosted_offline_after_seconds
                  )
                  and (
                    cardinality(eligible_runner.allowed_repositories) = 0
                    or exists (
                      select 1
                        from unnest(eligible_runner.allowed_repositories) eligible_repository
                       where lower(eligible_repository) = lower(repositories.owner || '/' || repositories.name)
                    )
                  )
             )
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

  if p_worker_class = 'managed' and selected_policy_mode = 'self_hosted_preferred' then
    selected_fallback_reason := 'no_eligible_self_hosted_runner_online';
  end if;

  select coalesce(max(release_run_attempts.attempt_number), 0) + 1
    into next_attempt_number
    from public.release_run_attempts
   where release_run_attempts.run_id = selected_run_id;

  insert into public.release_run_attempts (
    id, run_id, attempt_number, status, version,
    created_at, dispatch_requested_at, dispatched_at, started_at, heartbeat_at
  ) values (
    p_attempt_id, selected_run_id, next_attempt_number, 'in_progress', 0,
    p_now, p_now, p_now, p_now, p_now
  );

  update public.release_runs
     set execution_attempt_id = p_attempt_id,
         execution_attempt_started_at = p_now,
         status = 'running',
         version = release_runs.version + 1
   where release_runs.id = selected_run_id
     and release_runs.status = selected_run_status
     and release_runs.version = selected_run_version
     and release_runs.execution_attempt_id is not distinct from selected_current_attempt_id
  returning release_runs.version into selected_next_run_version;

  if selected_next_run_version is null then
    raise exception 'runner claim run changed after it was locked'
      using errcode = '40001';
  end if;

  insert into public.release_run_transition_events (
    installation_id, repository_id, release_run_id, execution_attempt_id,
    entity_type, from_status, to_status, from_version, to_version,
    reason_code, occurred_at
  ) values (
    selected_installation_id, selected_repository_id, selected_run_id, null,
    'release_run', selected_run_status, 'running', selected_run_version, selected_next_run_version,
    'runner_lease_claimed', p_now
  );

  insert into public.runner_job_leases (
    id, run_id, execution_attempt_id,
    worker_class, runner_registration_id, managed_runner_identity_id,
    lease_token_digest, status, stage,
    expected_run_status, expected_run_version,
    expected_attempt_status, expected_attempt_version,
    claimed_at, heartbeat_at, expires_at, maximum_expires_at
  ) values (
    p_lease_id, selected_run_id, p_attempt_id,
    p_worker_class, p_runner_registration_id, p_managed_runner_identity_id,
    p_lease_token_digest, 'active', 'claimed',
    'running', selected_next_run_version,
    'in_progress', 0,
    p_now, p_now, p_lease_expires_at, p_maximum_lease_expires_at
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
    installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    runner_registration_id, metadata
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
    jsonb_strip_nulls(jsonb_build_object(
      'executionAttemptId', p_attempt_id,
      'workerClass', p_worker_class,
      'expiresAt', p_lease_expires_at,
      'maximumExpiresAt', p_maximum_lease_expires_at,
      'routingPolicyMode', selected_policy_mode,
      'routingPolicySource', selected_policy_source,
      'selfHostedOfflineAfterSeconds', selected_offline_after_seconds,
      'fallbackReason', selected_fallback_reason
    ))
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
  run_record public.release_runs%rowtype;
  attempt_record public.release_run_attempts%rowtype;
  lease_record public.runner_job_leases%rowtype;
  nonce_id text;
  installation_id text;
  repository_id text;
  next_stage text;
  next_attempt_status text;
  next_attempt_version bigint;
  lifecycle_binding_valid boolean;
begin
  select release_runs.*
    into run_record
    from public.release_runs
   where release_runs.id = p_run_id
   for update of release_runs;

  select release_run_attempts.*
    into attempt_record
    from public.release_run_attempts
   where release_run_attempts.id = p_execution_attempt_id
     and release_run_attempts.run_id = p_run_id
   for update of release_run_attempts;

  select runner_job_leases.*
    into lease_record
    from public.runner_job_leases
   where runner_job_leases.id = p_lease_id
     and runner_job_leases.run_id = p_run_id
     and runner_job_leases.execution_attempt_id = p_execution_attempt_id
     and runner_job_leases.worker_class = p_worker_class
     and runner_job_leases.runner_registration_id is not distinct from p_runner_registration_id
     and runner_job_leases.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
   for update of runner_job_leases;

  if run_record.id is null or attempt_record.id is null or lease_record.id is null then
    outcome := 'stale';
    return next;
    return;
  end if;

  insert into public.runner_request_nonces (
    worker_class, runner_registration_id, managed_runner_identity_id,
    runner_job_lease_id, nonce_digest, request_timestamp, expires_at
  ) values (
    p_worker_class, p_runner_registration_id, p_managed_runner_identity_id,
    p_lease_id, p_nonce_digest, p_request_timestamp, p_nonce_expires_at
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

  lifecycle_binding_valid :=
    run_record.execution_attempt_id is not distinct from lease_record.execution_attempt_id
    and run_record.status is not distinct from lease_record.expected_run_status
    and run_record.version is not distinct from lease_record.expected_run_version
    and attempt_record.status is not distinct from lease_record.expected_attempt_status
    and attempt_record.version is not distinct from lease_record.expected_attempt_version;

  if not lifecycle_binding_valid then
    outcome := 'stale';
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

  next_attempt_status := case next_stage
    when 'uploading_artifacts' then 'uploading_artifacts'
    when 'reporting' then 'reporting'
    else 'in_progress'
  end;
  next_attempt_version := attempt_record.version;

  select repositories.installation_id, repositories.id
    into installation_id, repository_id
    from public.repositories
   where repositories.id = run_record.repository_id;

  if next_attempt_status is distinct from attempt_record.status then
    if not boardreadyops_release_run_attempt_transition_allowed(
      attempt_record.status,
      next_attempt_status
    ) then
      outcome := 'stale';
      return next;
      return;
    end if;

    update public.release_run_attempts
       set heartbeat_at = p_now,
           status = next_attempt_status,
           version = release_run_attempts.version + 1
     where release_run_attempts.id = lease_record.execution_attempt_id
       and release_run_attempts.run_id = lease_record.run_id
       and release_run_attempts.status = lease_record.expected_attempt_status
       and release_run_attempts.version = lease_record.expected_attempt_version
    returning release_run_attempts.version into next_attempt_version;

    if next_attempt_version is null then
      raise exception 'runner heartbeat attempt changed after it was locked'
        using errcode = '40001';
    end if;

    insert into public.release_run_transition_events (
      installation_id, repository_id, release_run_id, execution_attempt_id,
      entity_type, from_status, to_status, from_version, to_version,
      reason_code, occurred_at
    ) values (
      installation_id, repository_id, lease_record.run_id, lease_record.execution_attempt_id,
      'execution_attempt', attempt_record.status, next_attempt_status,
      attempt_record.version, next_attempt_version,
      'runner_lease_heartbeat', p_now
    );
  else
    update public.release_run_attempts
       set heartbeat_at = p_now
     where release_run_attempts.id = lease_record.execution_attempt_id
       and release_run_attempts.run_id = lease_record.run_id
       and release_run_attempts.status = lease_record.expected_attempt_status
       and release_run_attempts.version = lease_record.expected_attempt_version;
  end if;

  update public.runner_job_leases
     set heartbeat_at = p_now,
         expires_at = least(runner_job_leases.maximum_expires_at, p_extension_expires_at),
         stage = next_stage,
         progress_percent = case
           when p_progress_percent is null then runner_job_leases.progress_percent
           else greatest(coalesce(runner_job_leases.progress_percent, 0), p_progress_percent)
         end,
         last_message = coalesce(p_message, runner_job_leases.last_message),
         expected_attempt_status = next_attempt_status,
         expected_attempt_version = next_attempt_version
   where runner_job_leases.id = p_lease_id
  returning runner_job_leases.* into lease_record;

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
    installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    runner_registration_id, metadata
  ) values (
    installation_id,
    'runner.lease.renewed',
    case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
    coalesce(p_managed_runner_identity_id, p_runner_registration_id),
    'runner_lease',
    lease_record.id,
    repository_id,
    lease_record.run_id,
    p_runner_registration_id,
    jsonb_build_object(
      'executionAttemptId', lease_record.execution_attempt_id,
      'stage', lease_record.stage,
      'progressPercent', lease_record.progress_percent,
      'expiresAt', lease_record.expires_at
    )
  );

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
  run_record public.release_runs%rowtype;
  attempt_record public.release_run_attempts%rowtype;
  lease_record public.runner_job_leases%rowtype;
  nonce_id text;
  installation_id text;
  repository_id text;
  lifecycle_binding_valid boolean;
  next_run_version bigint;
  next_attempt_version bigint;
begin
  select release_runs.*
    into run_record
    from public.release_runs
   where release_runs.id = p_run_id
   for update of release_runs;

  select release_run_attempts.*
    into attempt_record
    from public.release_run_attempts
   where release_run_attempts.id = p_execution_attempt_id
     and release_run_attempts.run_id = p_run_id
   for update of release_run_attempts;

  select runner_job_leases.*
    into lease_record
    from public.runner_job_leases
   where runner_job_leases.id = p_lease_id
     and runner_job_leases.run_id = p_run_id
     and runner_job_leases.execution_attempt_id = p_execution_attempt_id
     and runner_job_leases.worker_class = p_worker_class
     and runner_job_leases.runner_registration_id is not distinct from p_runner_registration_id
     and runner_job_leases.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
   for update of runner_job_leases;

  if run_record.id is null
    or attempt_record.id is null
    or lease_record.id is null
    or lease_record.lease_token_digest <> p_lease_token_digest
  then
    return 'stale';
  end if;

  insert into public.runner_request_nonces (
    worker_class, runner_registration_id, managed_runner_identity_id,
    runner_job_lease_id, nonce_digest, request_timestamp, expires_at
  ) values (
    p_worker_class, p_runner_registration_id, p_managed_runner_identity_id,
    p_lease_id, p_nonce_digest, p_request_timestamp, p_nonce_expires_at
  )
  on conflict do nothing
  returning id into nonce_id;

  if nonce_id is null or lease_record.status = 'relinquished' then
    return 'replayed';
  end if;

  if lease_record.status <> 'active' or lease_record.expires_at <= p_now then
    return 'stale';
  end if;

  lifecycle_binding_valid :=
    run_record.execution_attempt_id is not distinct from lease_record.execution_attempt_id
    and run_record.status is not distinct from lease_record.expected_run_status
    and run_record.version is not distinct from lease_record.expected_run_version
    and attempt_record.status is not distinct from lease_record.expected_attempt_status
    and attempt_record.version is not distinct from lease_record.expected_attempt_version
    and run_record.status = 'running'
    and boardreadyops_release_run_attempt_transition_allowed(attempt_record.status, p_attempt_status);

  if not lifecycle_binding_valid then
    return 'stale';
  end if;

  select repositories.installation_id, repositories.id
    into installation_id, repository_id
    from public.repositories
   where repositories.id = run_record.repository_id;

  update public.release_run_attempts
     set status = p_attempt_status,
         version = release_run_attempts.version + 1,
         completed_at = coalesce(release_run_attempts.completed_at, p_now),
         failure_class = coalesce(release_run_attempts.failure_class, 'runner_relinquished'),
         failure_message = coalesce(release_run_attempts.failure_message, p_default_message)
   where release_run_attempts.id = p_execution_attempt_id
     and release_run_attempts.run_id = p_run_id
     and release_run_attempts.status = lease_record.expected_attempt_status
     and release_run_attempts.version = lease_record.expected_attempt_version
  returning release_run_attempts.version into next_attempt_version;

  if next_attempt_version is null then
    raise exception 'runner relinquish attempt changed after it was locked'
      using errcode = '40001';
  end if;

  update public.release_runs
     set status = 'queued',
         version = release_runs.version + 1
   where release_runs.id = p_run_id
     and release_runs.execution_attempt_id = p_execution_attempt_id
     and release_runs.status = lease_record.expected_run_status
     and release_runs.version = lease_record.expected_run_version
  returning release_runs.version into next_run_version;

  if next_run_version is null then
    raise exception 'runner relinquish run changed after it was locked'
      using errcode = '40001';
  end if;

  update public.runner_job_leases
     set status = 'relinquished',
         closed_at = p_now,
         close_reason = coalesce(p_message, p_default_message),
         expected_run_status = 'queued',
         expected_run_version = next_run_version,
         expected_attempt_status = p_attempt_status,
         expected_attempt_version = next_attempt_version
   where runner_job_leases.id = p_lease_id;

  insert into public.release_run_transition_events (
    installation_id, repository_id, release_run_id, execution_attempt_id,
    entity_type, from_status, to_status, from_version, to_version,
    reason_code, occurred_at
  ) values (
    installation_id, repository_id, p_run_id, null,
    'release_run', run_record.status, 'queued', run_record.version, next_run_version,
    'runner_lease_relinquished', p_now
  );

  insert into public.release_run_transition_events (
    installation_id, repository_id, release_run_id, execution_attempt_id,
    entity_type, from_status, to_status, from_version, to_version,
    reason_code, occurred_at
  ) values (
    installation_id, repository_id, p_run_id, p_execution_attempt_id,
    'execution_attempt', attempt_record.status, p_attempt_status,
    attempt_record.version, next_attempt_version,
    'runner_lease_relinquished', p_now
  );

  insert into public.audit_events (
    installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    runner_registration_id, metadata
  ) values (
    installation_id,
    'runner.lease.relinquished',
    case when p_worker_class = 'managed' then 'managed_runner' else 'runner' end,
    coalesce(p_managed_runner_identity_id, p_runner_registration_id),
    'runner_lease',
    p_lease_id,
    repository_id,
    p_run_id,
    p_runner_registration_id,
    jsonb_build_object(
      'executionAttemptId', p_execution_attempt_id,
      'reason', p_reason,
      'attemptStatus', p_attempt_status
    )
  );

  return 'accepted';
end;
$$;
