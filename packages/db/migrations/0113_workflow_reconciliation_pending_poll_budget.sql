-- A successful GitHub API observation is not a failed reconciliation attempt.
-- Earlier claims counted each pending poll towards the 12-error budget and could dead-letter
-- a real completed workflow before its authoritative callback deadline, leaving Check Runs
-- in progress forever. Preserve the deadline and lease/CAS guards; only errors consume budget.

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
     and subject_type = 'execution_attempt'
     and reason_code in ('callback_missing', 'attempt_stale')
   for update;

  if v_item.id is null or p_next_check_at <= p_now or p_now >= v_item.deadline_at then
    return 'stale';
  end if;

  update control_plane_reconciliation_items
     set status = 'available',
         attempt_count = 0,
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
     and subject_type = 'execution_attempt'
     and reason_code in ('callback_missing', 'attempt_stale');

  return case when found then 'rescheduled' else 'stale' end;
end;
$$;
