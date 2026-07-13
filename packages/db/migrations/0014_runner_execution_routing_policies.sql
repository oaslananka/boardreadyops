-- Tenant-scoped runner execution routing policy and claim enforcement.
--
-- Repository overrides take precedence over an installation default. In the
-- absence of either policy, managed-only execution is the fail-closed default.

create unique index if not exists repositories_id_installation_idx
  on repositories(id, installation_id);

create table if not exists runner_execution_policies (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text,
  mode text not null,
  self_hosted_offline_after_seconds integer not null default 300,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runner_execution_policies_repository_scope_fk
    foreign key (repository_id, installation_id)
    references repositories(id, installation_id)
    on delete cascade,
  constraint runner_execution_policies_mode_valid
    check (mode in ('managed_only', 'self_hosted_required', 'self_hosted_preferred', 'disabled')),
  constraint runner_execution_policies_offline_window_valid
    check (self_hosted_offline_after_seconds between 30 and 3600),
  constraint runner_execution_policies_timestamps_valid
    check (updated_at >= created_at)
);

create unique index if not exists runner_execution_policies_installation_default_idx
  on runner_execution_policies(installation_id)
  where repository_id is null;

create unique index if not exists runner_execution_policies_repository_override_idx
  on runner_execution_policies(installation_id, repository_id)
  where repository_id is not null;

create or replace function boardreadyops_effective_runner_policy(
  p_installation_id text,
  p_repository_id text
)
returns table (
  policy_mode text,
  policy_source text,
  self_hosted_offline_after_seconds integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with target_repository as (
    select repositories.id, repositories.installation_id
    from public.repositories
    where repositories.id = p_repository_id
      and repositories.installation_id = p_installation_id
  ),
  candidates as (
    select policies.mode as policy_mode,
           'repository'::text as policy_source,
           policies.self_hosted_offline_after_seconds,
           1 as priority
    from target_repository
    join public.runner_execution_policies policies
      on policies.installation_id = target_repository.installation_id
     and policies.repository_id = target_repository.id

    union all

    select policies.mode,
           'installation'::text,
           policies.self_hosted_offline_after_seconds,
           2
    from target_repository
    join public.runner_execution_policies policies
      on policies.installation_id = target_repository.installation_id
     and policies.repository_id is null

    union all

    select 'managed_only'::text,
           'implicit_default'::text,
           300,
           3
    from target_repository
  )
  select candidates.policy_mode,
         candidates.policy_source,
         candidates.self_hosted_offline_after_seconds
  from candidates
  order by candidates.priority
  limit 1;
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
         repositories.private,
         effective_policy.policy_mode,
         effective_policy.policy_source,
         effective_policy.self_hosted_offline_after_seconds
  into selected_run_id,
       selected_repository_id,
       selected_commit_sha,
       selected_installation_id,
       selected_owner,
       selected_name,
       selected_private,
       selected_policy_mode,
       selected_policy_source,
       selected_offline_after_seconds
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
