-- Operator-only repair for a pre-0113 exhausted callback-missing reconciliation.
-- Installing this migration changes NO stored jobs, runs, claims, or Check Runs.
-- The caller must independently verify the exact GitHub workflow and Check Run
-- and finish the protected production handoff before invoking this function.
-- Never turn a successful GitHub workflow into a signed hardware PASS.

create or replace function boardreadyops_reactivate_legacy_callback_dead_letter(
  p_installation_id text,
  p_reconciliation_id text,
  p_expected_workflow_run_id text,
  p_expected_check_run_id bigint,
  p_actor_id text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_item control_plane_reconciliation_items%rowtype;
  v_run_id text;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null
    or char_length(p_actor_id) < 3
    or char_length(p_actor_id) > 128
    or p_actor_id !~ '^[a-zA-Z0-9._:-]+$'
    or p_expected_workflow_run_id is null
    or p_expected_workflow_run_id !~ '^[1-9][0-9]{0,19}$'
    or p_expected_check_run_id is null
    or p_expected_check_run_id <= 0
  then
    raise exception 'invalid legacy reconciliation recovery input' using errcode = '22023';
  end if;

  select c.*
    into v_item
    from control_plane_reconciliation_items c
   where c.id = p_reconciliation_id
     and c.installation_id = p_installation_id
   for update;

  if v_item.id is null
    or v_item.status <> 'dead_letter'
    or v_item.subject_type <> 'execution_attempt'
    or v_item.reason_code <> 'callback_missing'
    or v_item.outcome_code <> 'github_result_callback_pending'
    or v_item.public_failure_reason is distinct from 'operator_replay_required'
    or v_item.repaired
    or v_item.attempt_count <> 12
    or v_item.max_attempts <> 12
    or v_item.completed_at is null
    or v_item.deadline_at >= v_now
    or v_item.created_at >= '2026-11-09T14:24:26Z'::timestamptz
    or v_item.release_run_id is null
    or v_item.execution_attempt_id is null
    or v_item.subject_id is distinct from v_item.execution_attempt_id
  then
    return 'not_recoverable';
  end if;

  -- Lock the exact current run and attempt. The original expected status and
  -- version are immutable snapshots; any new signed result or retry is a stop.
  select r.id into v_run_id
    from release_runs r
    join release_run_attempts a
      on a.id = v_item.execution_attempt_id
     and a.run_id = r.id
    join repositories repo on repo.id = r.repository_id
    join installations i on i.id = repo.installation_id
   where r.id = v_item.release_run_id
     and r.repository_id = v_item.repository_id
     and i.id = v_item.installation_id
     and i.suspended_at is null
     and repo.disabled_at is null
     and r.execution_attempt_id = a.id
     and r.status = 'dispatched'
     and a.status = 'dispatched'
     -- The versioned run transition stores duration_ms as a 32-bit integer.
     -- Refuse an age that could overflow it instead of requeueing a broken job.
     and r.started_at >= v_now - interval '24 days'
     and r.status = v_item.expected_run_status
     and r.version = v_item.expected_run_version
     and a.status = v_item.expected_attempt_status
     and a.version = v_item.expected_attempt_version
     and r.terminal_result_digest is null
     and a.result_digest is null
     and r.github_check_run_id = p_expected_check_run_id
     and a.github_workflow_dispatch_id = p_expected_workflow_run_id
     and not exists (
       select 1 from release_run_results signed
        where signed.run_id = r.id
     )
     and not exists (
       select 1 from runner_job_leases lease
        where lease.run_id = r.id and lease.closed_at is null
     )
     and not exists (
       select 1 from control_plane_outbox effect
        where effect.release_run_id = r.id
          and effect.status not in ('completed', 'dead_letter')
     )
     and not exists (
       select 1 from control_plane_reconciliation_items other
        where other.id <> v_item.id
          and other.installation_id = v_item.installation_id
          and other.execution_attempt_id = a.id
          and other.status in ('available', 'leased')
     )
   for update of r, a;

  if v_run_id is null then
    return 'not_recoverable';
  end if;

  -- Reenter only the EXISTING worker's read-only GitHub observation path.
  -- Its expired deadline forces the signed-callback-missing failure path;
  -- subsequent Check Run reconciliation, not this function, publishes status.
  update control_plane_reconciliation_items
     set status = 'available',
         attempt_count = 0,
         next_check_at = v_now,
         completed_at = null,
         lease_owner = null,
         lease_expires_at = null,
         outcome_code = 'operator_legacy_callback_recovery',
         repaired = false,
         public_failure_reason = null,
         last_error_class = null,
         last_error_message = null
   where id = v_item.id
     and status = 'dead_letter'
     and installation_id = v_item.installation_id;

  if not found then
    raise exception 'legacy reconciliation changed during recovery' using errcode = '40001';
  end if;

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    metadata, created_at
  ) values (
    gen_random_uuid()::text, v_item.installation_id,
    'control_plane.legacy_callback_reconciliation_reactivated',
    'operator', p_actor_id, 'execution_attempt', v_item.execution_attempt_id,
    v_item.repository_id, v_run_id,
    jsonb_build_object(
      'reasonCode', 'callback_missing',
      'outcome', 'reactivated_for_authoritative_reconciliation',
      'fromState', 'dead_letter'
    ), v_now
  );
  return 'reactivated';
end;
$$;

-- Explicitly remove default PUBLIC EXECUTE on this operator-only repair.
revoke execute on function boardreadyops_reactivate_legacy_callback_dead_letter(
  text, text, text, bigint, text
) from public;
