-- Stop a reconciliation item that has spent its attempt budget from being rescheduled.
--
-- boardreadyops_reschedule_github_workflow_reconciliation returned an item to 'available'
-- without consulting attempt_count, so a workflow that never settled came back claimable with
-- its budget already spent. The claim then attempted attempt_count + 1, violated
-- control_plane_reconciliation_attempts_valid, and the abort took the entire claim statement --
-- so a single item stopped every reconciliation loop and crash-looped the worker.
--
-- The reschedule path now gives up the way boardreadyops_fail_control_plane_reconciliation
-- already does, and no claim will consider an exhausted item even if one appears again.

create or replace function boardreadyops_claim_control_plane_reconciliation(
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
         last_error_message = 'The reconciliation lease expired before the item reached a terminal state.'
    from expired
   where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
      from control_plane_reconciliation_items cpri
     where cpri.status = 'available'
       and cpri.attempt_count < cpri.max_attempts
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
       and cpri.attempt_count < cpri.max_attempts
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

create or replace function boardreadyops_claim_github_check_run_reconciliation(
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
      and cpri.subject_type = 'release_run'
      and cpri.reason_code = 'reporting_stale'
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
        when expired.attempt_count >= expired.max_attempts then 'github_check_run_reconciliation_failed'
        else null
      end,
      last_error_class = 'lease_expired',
      last_error_message = 'The GitHub Check Run reconciliation lease expired before completion.'
  from expired
  where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
    from control_plane_reconciliation_items cpri
    where cpri.status = 'available'
      and cpri.attempt_count < cpri.max_attempts
      and cpri.subject_type = 'release_run'
      and cpri.reason_code = 'reporting_stale'
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

create or replace function boardreadyops_claim_control_plane_lifecycle_reconciliation(
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
       and cpri.reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')
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
         last_error_message = 'The lifecycle reconciliation lease expired before completion.'
    from expired
   where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
      from control_plane_reconciliation_items cpri
     where cpri.status = 'available'
       and cpri.attempt_count < cpri.max_attempts
       and cpri.reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')
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
declare
  v_item control_plane_reconciliation_items%rowtype;
begin
  if p_outcome_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'invalid workflow reconciliation outcome code' using errcode = '22023';
  end if;

  select * into v_item
    from control_plane_reconciliation_items
   where id = p_reconciliation_id
     and status = 'leased'
     and lease_owner = p_worker_id
   for update;

  if v_item.id is null or p_next_check_at <= p_now then
    return 'stale';
  end if;

  -- max_attempts is the backstop for a workflow that never settles. Rescheduling past it put
  -- the item back on the queue with its budget already spent, and the next claim's
  -- attempt_count + 1 then violated control_plane_reconciliation_attempts_valid -- aborting the
  -- claim for every waiting item, not just this one. Give up here instead.
  if v_item.attempt_count >= v_item.max_attempts then
    update control_plane_reconciliation_items
       set status = 'dead_letter',
           lease_owner = null,
           lease_expires_at = null,
           completed_at = p_now,
           outcome_code = p_outcome_code,
           repaired = false,
           public_failure_reason = 'operator_replay_required',
           last_error_class = null,
           last_error_message = null
     where id = p_reconciliation_id;

    insert into audit_events (
      id, installation_id, event_type, actor_type, actor_id,
      subject_type, subject_id, repository_id, release_run_id,
      metadata, created_at
    ) values (
      gen_random_uuid()::text, v_item.installation_id,
      'control_plane.reconciliation_dead_lettered', 'system', p_worker_id,
      'control_plane_reconciliation', v_item.id,
      v_item.repository_id, v_item.release_run_id,
      jsonb_build_object('reasonCode', v_item.reason_code, 'outcome', 'dead_letter'),
      p_now
    );

    return 'dead_letter';
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
