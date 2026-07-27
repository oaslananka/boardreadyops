-- Bind GitHub workflow reconciliation work to the release-run and attempt
-- state that was authoritative when reconciliation was detected, then apply
-- terminal outcomes through the versioned transition API.

alter table control_plane_reconciliation_items
  add column if not exists expected_run_status text,
  add column if not exists expected_run_version bigint,
  add column if not exists expected_attempt_status text,
  add column if not exists expected_attempt_version bigint;

update control_plane_reconciliation_items
   set expected_run_status = release_runs.status,
       expected_run_version = release_runs.version,
       expected_attempt_status = release_run_attempts.status,
       expected_attempt_version = release_run_attempts.version
  from release_run_attempts
  join release_runs on release_runs.id = release_run_attempts.run_id
 where control_plane_reconciliation_items.subject_type = 'execution_attempt'
   and control_plane_reconciliation_items.reason_code in ('callback_missing', 'attempt_stale')
   and control_plane_reconciliation_items.release_run_id = release_runs.id
   and control_plane_reconciliation_items.execution_attempt_id = release_run_attempts.id;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'control_plane_reconciliation_workflow_snapshot'
  ) then
    alter table control_plane_reconciliation_items
      add constraint control_plane_reconciliation_workflow_snapshot
      check (
        (
          subject_type = 'execution_attempt'
          and reason_code in ('callback_missing', 'attempt_stale')
          and expected_run_status is not null
          and expected_run_version is not null
          and expected_run_version >= 0
          and expected_attempt_status is not null
          and expected_attempt_version is not null
          and expected_attempt_version >= 0
        )
        or (
          not (
            subject_type = 'execution_attempt'
            and reason_code in ('callback_missing', 'attempt_stale')
          )
          and expected_run_status is null
          and expected_run_version is null
          and expected_attempt_status is null
          and expected_attempt_version is null
        )
      ) not valid;
  end if;
end;
$$;

alter table control_plane_reconciliation_items
  validate constraint control_plane_reconciliation_workflow_snapshot;

create or replace function boardreadyops_bind_workflow_reconciliation_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.subject_type = 'execution_attempt'
     and new.reason_code in ('callback_missing', 'attempt_stale')
  then
    select release_runs.status,
           release_runs.version,
           release_run_attempts.status,
           release_run_attempts.version
      into new.expected_run_status,
           new.expected_run_version,
           new.expected_attempt_status,
           new.expected_attempt_version
      from release_run_attempts
      join release_runs on release_runs.id = release_run_attempts.run_id
     where release_runs.id = new.release_run_id
       and release_run_attempts.id = new.execution_attempt_id
       and release_runs.execution_attempt_id = release_run_attempts.id
       and release_runs.status in ('queued', 'dispatched', 'running')
       and release_run_attempts.status in ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting');

    if not found then
      raise exception 'workflow reconciliation snapshot subject is not current and non-terminal'
        using errcode = '23514';
    end if;
  else
    new.expected_run_status := null;
    new.expected_run_version := null;
    new.expected_attempt_status := null;
    new.expected_attempt_version := null;
  end if;

  return new;
end;
$$;

create or replace function boardreadyops_keep_workflow_reconciliation_snapshot_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.subject_type is distinct from new.subject_type
    or old.reason_code is distinct from new.reason_code
    or old.release_run_id is distinct from new.release_run_id
    or old.execution_attempt_id is distinct from new.execution_attempt_id
    or old.expected_run_status is distinct from new.expected_run_status
    or old.expected_run_version is distinct from new.expected_run_version
    or old.expected_attempt_status is distinct from new.expected_attempt_status
    or old.expected_attempt_version is distinct from new.expected_attempt_version
  then
    raise exception 'workflow reconciliation snapshot is immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists control_plane_reconciliation_workflow_snapshot_bind
  on control_plane_reconciliation_items;
create trigger control_plane_reconciliation_workflow_snapshot_bind
  before insert on control_plane_reconciliation_items
  for each row execute function boardreadyops_bind_workflow_reconciliation_snapshot();

drop trigger if exists control_plane_reconciliation_workflow_snapshot_immutable
  on control_plane_reconciliation_items;
create trigger control_plane_reconciliation_workflow_snapshot_immutable
  before update of subject_type, reason_code, release_run_id, execution_attempt_id,
    expected_run_status, expected_run_version, expected_attempt_status, expected_attempt_version
  on control_plane_reconciliation_items
  for each row execute function boardreadyops_keep_workflow_reconciliation_snapshot_immutable();

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
    and control_plane_reconciliation_items.reason_code in ('callback_missing', 'attempt_stale')
    and release_run_attempts.github_workflow_dispatch_id is not null
    and release_runs.execution_attempt_id = release_run_attempts.id
    and release_runs.status = control_plane_reconciliation_items.expected_run_status
    and release_runs.version = control_plane_reconciliation_items.expected_run_version
    and release_run_attempts.status = control_plane_reconciliation_items.expected_attempt_status
    and release_run_attempts.version = control_plane_reconciliation_items.expected_attempt_version;
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
  v_transition_outcome text;
  v_transition_run_version bigint;
  v_transition_attempt_version bigint;
begin
  if p_terminal_status not in ('failed', 'timed_out') then
    raise exception 'invalid workflow reconciliation terminal status' using errcode = '22023';
  end if;
  if p_observed_status !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or (p_observed_conclusion is not null and p_observed_conclusion !~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
     or p_public_failure_reason !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'invalid workflow reconciliation observation' using errcode = '22023';
  end if;

  select control_plane_reconciliation_items.*
    into v_item
    from control_plane_reconciliation_items
   where control_plane_reconciliation_items.id = p_reconciliation_id
     and control_plane_reconciliation_items.status = 'leased'
     and control_plane_reconciliation_items.lease_owner = p_worker_id
     and control_plane_reconciliation_items.subject_type = 'execution_attempt'
     and control_plane_reconciliation_items.reason_code in ('callback_missing', 'attempt_stale')
   for update of control_plane_reconciliation_items;

  if v_item.id is null then
    return 'stale';
  end if;

  select release_run_attempts.*
    into v_attempt
    from release_run_attempts
   where release_run_attempts.id = v_item.execution_attempt_id
     and release_run_attempts.run_id = v_item.release_run_id;

  select release_runs.*
    into v_run
    from release_runs
   where release_runs.id = v_item.release_run_id;

  if v_attempt.id is null
    or v_run.id is null
    or v_run.execution_attempt_id is distinct from v_attempt.id
  then
    return 'stale';
  end if;

  if v_attempt.status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
     or v_run.status in ('completed', 'failed', 'timed_out', 'cancelled', 'superseded') then
    v_outcome := 'already_terminal';
  else
    select transitioned.transition_outcome,
           transitioned.run_version,
           transitioned.attempt_version
      into v_transition_outcome,
           v_transition_run_version,
           v_transition_attempt_version
      from boardreadyops_transition_release_run_state(
        v_run.id,
        v_item.expected_run_status,
        v_item.expected_run_version,
        v_attempt.id,
        p_terminal_status,
        'github_workflow_reconciled',
        p_now,
        v_item.expected_attempt_status,
        v_item.expected_attempt_version,
        p_terminal_status
      ) as transitioned;

    if v_transition_outcome <> 'applied'
      or v_transition_run_version is null
      or v_transition_attempt_version is null
    then
      return 'stale';
    end if;

    update release_run_attempts
       set failure_class = coalesce(
             release_run_attempts.failure_class,
             left(p_public_failure_reason, 128)
           ),
           failure_message = coalesce(
             release_run_attempts.failure_message,
             'Authoritative GitHub workflow reconciliation closed the execution attempt.'
           )
     where release_run_attempts.id = v_attempt.id
       and release_run_attempts.run_id = v_run.id
       and release_run_attempts.status = p_terminal_status
       and release_run_attempts.version = v_transition_attempt_version;

    if not found then
      raise exception 'workflow reconciliation failure metadata changed after guarded transition'
        using errcode = '40001';
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
   where control_plane_reconciliation_items.id = v_item.id
     and control_plane_reconciliation_items.status = 'leased'
     and control_plane_reconciliation_items.lease_owner = p_worker_id;

  if not found then
    raise exception 'workflow reconciliation lease changed while applying the terminal result'
      using errcode = '40001';
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
