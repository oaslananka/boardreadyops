-- Tenant-scoped GitHub workflow reconciliation for missed runner callbacks.

create or replace function boardreadyops_detect_github_workflow_reconciliation(
  p_now timestamptz,
  p_observation_delay_seconds integer,
  p_terminal_deadline_seconds integer,
  p_limit integer default 100
)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_detected bigint;
begin
  if p_observation_delay_seconds < 1 or p_terminal_deadline_seconds < 1 or p_limit < 1 then
    raise exception 'workflow reconciliation intervals and limit must be positive' using errcode = '22023';
  end if;
  if p_terminal_deadline_seconds <= p_observation_delay_seconds then
    raise exception 'workflow reconciliation deadline must exceed observation delay' using errcode = '22023';
  end if;

  with stale_attempts as (
    select
      installations.id as installation_id,
      repositories.id as repository_id,
      release_runs.id as release_run_id,
      release_run_attempts.id as execution_attempt_id,
      release_run_attempts.status as attempt_status,
      coalesce(
        release_run_attempts.heartbeat_at,
        release_run_attempts.started_at,
        release_run_attempts.dispatched_at,
        release_run_attempts.dispatch_requested_at,
        release_run_attempts.created_at
      ) as observed_from
    from release_run_attempts
    join release_runs on release_runs.id = release_run_attempts.run_id
    join repositories on repositories.id = release_runs.repository_id
    join installations on installations.id = repositories.installation_id
    where release_runs.execution_attempt_id = release_run_attempts.id
      and release_run_attempts.github_workflow_dispatch_id is not null
      and release_run_attempts.status in ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting')
      and release_runs.status in ('queued', 'dispatched', 'running')
      and not exists (
        select 1
          from control_plane_reconciliation_items existing
         where existing.execution_attempt_id = release_run_attempts.id
           and existing.subject_type = 'execution_attempt'
           and existing.reason_code in ('callback_missing', 'attempt_stale')
      )
  ), candidates as (
    select
      gen_random_uuid()::text as reconciliation_id,
      stale_attempts.installation_id,
      stale_attempts.repository_id,
      stale_attempts.release_run_id,
      stale_attempts.execution_attempt_id,
      stale_attempts.observed_from,
      case
        when stale_attempts.attempt_status = 'dispatched' then 'callback_missing'
        else 'attempt_stale'
      end as reason_code
    from stale_attempts
    where stale_attempts.observed_from <= p_now - make_interval(secs => p_observation_delay_seconds)
    order by stale_attempts.observed_from asc, stale_attempts.execution_attempt_id asc
    limit greatest(1, least(p_limit, 1000))
  ), inserted as (
    insert into control_plane_reconciliation_items (
      id,
      installation_id,
      repository_id,
      release_run_id,
      execution_attempt_id,
      subject_type,
      subject_id,
      reason_code,
      status,
      deadline_at,
      next_check_at,
      attempt_count,
      max_attempts,
      created_at
    )
    select
      candidates.reconciliation_id,
      candidates.installation_id,
      candidates.repository_id,
      candidates.release_run_id,
      candidates.execution_attempt_id,
      'execution_attempt',
      candidates.execution_attempt_id,
      candidates.reason_code,
      'available',
      candidates.observed_from + make_interval(secs => p_terminal_deadline_seconds),
      p_now,
      0,
      12,
      p_now
    from candidates
    on conflict do nothing
    returning id
  )
  select count(*) into v_detected from inserted;

  return coalesce(v_detected, 0);
end;
$$;

create or replace function boardreadyops_claim_github_workflow_reconciliation(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  reconciliation_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  execution_attempt_id text,
  subject_type text,
  subject_id text,
  reason_code text,
  deadline_at timestamptz,
  next_check_at timestamptz,
  attempt_count integer
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpri.id, cpri.attempt_count, cpri.max_attempts
      from control_plane_reconciliation_items cpri
     where cpri.status = 'leased'
       and cpri.subject_type = 'execution_attempt'
       and cpri.reason_code in ('callback_missing', 'attempt_stale')
       and cpri.lease_expires_at <= p_now
     for update skip locked
  )
  update control_plane_reconciliation_items cpri
     set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
         next_check_at = case when expired.attempt_count >= expired.max_attempts then cpri.next_check_at else p_now end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
         public_failure_reason = case
           when expired.attempt_count >= expired.max_attempts then 'operator_replay_required'
           else null
         end,
         last_error_class = 'lease_expired',
         last_error_message = 'The GitHub workflow reconciliation lease expired before completion.'
    from expired
   where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
      from control_plane_reconciliation_items cpri
     where cpri.status = 'available'
       and cpri.subject_type = 'execution_attempt'
       and cpri.reason_code in ('callback_missing', 'attempt_stale')
       and cpri.next_check_at <= p_now
     order by cpri.next_check_at asc, cpri.deadline_at asc, cpri.created_at asc, cpri.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_reconciliation_items cpri
       set status = 'leased',
           attempt_count = cpri.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = p_lease_expires_at,
           completed_at = null,
           outcome_code = null,
           repaired = false,
           public_failure_reason = null,
           last_error_class = null,
           last_error_message = null
      from candidates
     where cpri.id = candidates.id
    returning cpri.*
  )
  select claimed.id, claimed.installation_id, claimed.repository_id,
         claimed.release_run_id, claimed.execution_attempt_id,
         claimed.subject_type, claimed.subject_id, claimed.reason_code,
         claimed.deadline_at, claimed.next_check_at, claimed.attempt_count
    from claimed
   order by claimed.next_check_at asc, claimed.deadline_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_github_workflow_reconciliation_context(
  p_reconciliation_id text,
  p_worker_id text
)
returns table(
  reconciliation_id text,
  installation_id text,
  github_installation_id bigint,
  repository_id text,
  repository_owner text,
  repository_name text,
  repository_full_name text,
  release_run_id text,
  execution_attempt_id text,
  github_workflow_run_id text,
  attempt_status text,
  deadline_at timestamptz
)
language sql
security invoker
stable
as $$
  select
    control_plane_reconciliation_items.id,
    installations.id,
    installations.github_installation_id,
    repositories.id,
    repositories.owner,
    repositories.name,
    repositories.owner || '/' || repositories.name,
    release_runs.id,
    release_run_attempts.id,
    release_run_attempts.github_workflow_dispatch_id,
    release_run_attempts.status,
    control_plane_reconciliation_items.deadline_at
  from control_plane_reconciliation_items
  join release_run_attempts
    on release_run_attempts.id = control_plane_reconciliation_items.execution_attempt_id
  join release_runs
    on release_runs.id = release_run_attempts.run_id
   and release_runs.id = control_plane_reconciliation_items.release_run_id
  join repositories
    on repositories.id = release_runs.repository_id
   and repositories.id = control_plane_reconciliation_items.repository_id
  join installations
    on installations.id = repositories.installation_id
   and installations.id = control_plane_reconciliation_items.installation_id
  where control_plane_reconciliation_items.id = p_reconciliation_id
    and control_plane_reconciliation_items.status = 'leased'
    and control_plane_reconciliation_items.lease_owner = p_worker_id
    and control_plane_reconciliation_items.subject_type = 'execution_attempt'
    and release_run_attempts.github_workflow_dispatch_id is not null
    and release_runs.execution_attempt_id = release_run_attempts.id;
$$;

create or replace function boardreadyops_reschedule_github_workflow_reconciliation(
  p_reconciliation_id text,
  p_worker_id text,
  p_now timestamptz,
  p_next_check_at timestamptz,
  p_outcome_code text
)
returns text
language plpgsql
security invoker
as $$
begin
  if p_outcome_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'invalid workflow reconciliation outcome code' using errcode = '22023';
  end if;

  update control_plane_reconciliation_items
     set status = 'available',
         next_check_at = least(p_next_check_at, deadline_at),
         lease_owner = null,
         lease_expires_at = null,
         completed_at = null,
         outcome_code = p_outcome_code,
         repaired = false,
         public_failure_reason = null,
         last_error_class = null,
         last_error_message = null
   where id = p_reconciliation_id
     and status = 'leased'
     and lease_owner = p_worker_id
     and p_next_check_at > p_now;

  return case when found then 'rescheduled' else 'stale' end;
end;
$$;

create or replace function boardreadyops_apply_github_workflow_reconciliation(
  p_reconciliation_id text,
  p_worker_id text,
  p_now timestamptz,
  p_observed_status text,
  p_observed_conclusion text,
  p_terminal_status text,
  p_public_failure_reason text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_item control_plane_reconciliation_items%rowtype;
  v_attempt release_run_attempts%rowtype;
  v_run release_runs%rowtype;
  v_outcome text;
begin
  if p_terminal_status not in ('failed', 'timed_out') then
    raise exception 'invalid workflow reconciliation terminal status' using errcode = '22023';
  end if;
  if p_observed_status !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or (p_observed_conclusion is not null and p_observed_conclusion !~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
     or p_public_failure_reason !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'invalid workflow reconciliation observation' using errcode = '22023';
  end if;

  select cpri, rra, rr
    into v_item, v_attempt, v_run
    from control_plane_reconciliation_items cpri
    join release_run_attempts rra
      on rra.id = cpri.execution_attempt_id
    join release_runs rr
      on rr.id = rra.run_id
     and rr.id = cpri.release_run_id
   where cpri.id = p_reconciliation_id
     and cpri.status = 'leased'
     and cpri.lease_owner = p_worker_id
     and cpri.subject_type = 'execution_attempt'
     and rr.execution_attempt_id = rra.id
   -- for update of control_plane_reconciliation_items, release_run_attempts, release_runs
   for update of cpri, rra, rr;

  if v_item.id is null then
    return 'stale';
  end if;

  if v_attempt.status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
     or v_run.status in ('completed', 'failed', 'timed_out', 'superseded') then
    v_outcome := 'already_terminal';
  else
    update release_run_attempts
       set status = p_terminal_status,
           completed_at = coalesce(completed_at, p_now),
           failure_class = coalesce(failure_class, left(p_public_failure_reason, 128)),
           failure_message = coalesce(failure_message, 'Authoritative GitHub workflow reconciliation closed the execution attempt.')
     where id = v_attempt.id
       and run_id = v_run.id
       and status in ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting');

    if not found then
      raise exception 'workflow reconciliation attempt changed while leased' using errcode = '40001';
    end if;

    update release_runs
       set status = p_terminal_status,
           completed_at = coalesce(completed_at, p_now),
           duration_ms = coalesce(
             duration_ms,
             greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000))::integer
           )
     where id = v_run.id
       and execution_attempt_id = v_attempt.id
       and status in ('queued', 'dispatched', 'running');

    if not found then
      raise exception 'workflow reconciliation run changed while leased' using errcode = '40001';
    end if;
    v_outcome := 'applied';
  end if;

  update control_plane_reconciliation_items
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = p_now,
         outcome_code = case when v_outcome = 'applied' then 'github_workflow_reconciled' else 'already_terminal' end,
         repaired = v_outcome = 'applied',
         public_failure_reason = case when v_outcome = 'applied' then p_public_failure_reason else null end,
         last_error_class = null,
         last_error_message = null
   where id = v_item.id
     and status = 'leased'
     and lease_owner = p_worker_id;

  if not found then
    raise exception 'workflow reconciliation lease changed while applying the terminal result' using errcode = '40001';
  end if;

  insert into audit_events (
    id,
    installation_id,
    event_type,
    actor_type,
    actor_id,
    subject_type,
    subject_id,
    repository_id,
    release_run_id,
    metadata,
    created_at
  ) values (
    gen_random_uuid()::text,
    v_item.installation_id,
    'control_plane.github_workflow_reconciled',
    'system',
    p_worker_id,
    'execution_attempt',
    v_attempt.id,
    v_item.repository_id,
    v_run.id,
    jsonb_strip_nulls(jsonb_build_object(
      'reconciliationId', v_item.id,
      'reasonCode', v_item.reason_code,
      'observedStatus', p_observed_status,
      'observedConclusion', p_observed_conclusion,
      'terminalStatus', case when v_outcome = 'applied' then p_terminal_status else null end,
      'publicFailureReason', case when v_outcome = 'applied' then p_public_failure_reason else null end,
      'outcome', v_outcome
    )),
    p_now
  );

  return v_outcome;
end;
$$;
