-- Bind runner claims to the immutable release-run trust snapshot.
-- Fork and draft snapshots are intentionally ineligible for runner execution so
-- no worker can race the neutral safe-mode completion path. Private same-repository
-- runs remain claimable and carry their persisted reduced-trust context.

drop function if exists boardreadyops_claim_runner_job(
  timestamptz, text, text, text, jsonb, text, timestamptz, timestamptz,
  text, text, text, timestamptz, timestamptz
);

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
  repository_private boolean,
  trust_mode text,
  safe_mode_reasons text[]
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
  selected_trust_mode text;
  selected_safe_mode_reasons text[];
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
         release_runs.trust_mode,
         release_runs.safe_mode_reasons,
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
         selected_trust_mode,
         selected_safe_mode_reasons,
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
     and not ('draft-pull-request' = any(release_runs.safe_mode_reasons))
     and not ('fork-pull-request' = any(release_runs.safe_mode_reasons))
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
      'fallbackReason', selected_fallback_reason,
      'trustMode', selected_trust_mode,
      'safeModeReasons', to_jsonb(selected_safe_mode_reasons)
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
  trust_mode := selected_trust_mode;
  safe_mode_reasons := selected_safe_mode_reasons;
  return next;
end;
$$;
