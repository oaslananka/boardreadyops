-- Bind workflow-dispatch outbox effects to the authoritative run and attempt
-- versions that existed when the effect was created, then use those immutable
-- expectations when completing the external delivery.

alter table control_plane_outbox
  add column if not exists expected_run_version bigint;

alter table control_plane_outbox
  add column if not exists expected_attempt_version bigint;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'control_plane_outbox_expected_versions_non_negative'
  ) then
    alter table control_plane_outbox
      add constraint control_plane_outbox_expected_versions_non_negative
      check (
        (expected_run_version is null or expected_run_version >= 0)
        and (expected_attempt_version is null or expected_attempt_version >= 0)
      );
  end if;
end;
$$;

update control_plane_outbox
   set expected_run_version = release_runs.version,
       expected_attempt_version = release_run_attempts.version
  from release_runs
  join release_run_attempts
    on release_run_attempts.run_id = release_runs.id
 where control_plane_outbox.effect_type = 'github.workflow.dispatch'
   and control_plane_outbox.release_run_id = release_runs.id
   and control_plane_outbox.execution_attempt_id = release_run_attempts.id
   and (
     control_plane_outbox.expected_run_version is null
     or control_plane_outbox.expected_attempt_version is null
   );

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'control_plane_outbox_workflow_dispatch_version_binding'
  ) then
    alter table control_plane_outbox
      add constraint control_plane_outbox_workflow_dispatch_version_binding
      check (
        (
          effect_type = 'github.workflow.dispatch'
          and release_run_id is not null
          and execution_attempt_id is not null
          and expected_run_version is not null
          and expected_attempt_version is not null
        )
        or (
          effect_type <> 'github.workflow.dispatch'
          and expected_run_version is null
          and expected_attempt_version is null
        )
      ) not valid;
  end if;
end;
$$;

alter table control_plane_outbox
  validate constraint control_plane_outbox_workflow_dispatch_version_binding;

create or replace function boardreadyops_bind_workflow_dispatch_versions()
returns trigger
language plpgsql
as $$
declare
  v_run_version bigint;
  v_attempt_version bigint;
begin
  if new.effect_type <> 'github.workflow.dispatch' then
    new.expected_run_version := null;
    new.expected_attempt_version := null;
    return new;
  end if;

  select existing.expected_run_version, existing.expected_attempt_version
    into v_run_version, v_attempt_version
    from control_plane_outbox existing
   where existing.idempotency_key = new.idempotency_key;

  if found then
    new.expected_run_version := v_run_version;
    new.expected_attempt_version := v_attempt_version;
    return new;
  end if;

  if new.release_run_id is null or new.execution_attempt_id is null then
    raise exception 'workflow dispatch effect requires a release run and execution attempt'
      using errcode = '23514';
  end if;

  select release_runs.version, release_run_attempts.version
    into v_run_version, v_attempt_version
    from release_runs
    join release_run_attempts
      on release_run_attempts.run_id = release_runs.id
   where release_runs.id = new.release_run_id
     and release_run_attempts.id = new.execution_attempt_id
     and release_runs.execution_attempt_id = release_run_attempts.id;

  if not found then
    raise exception 'workflow dispatch effect must bind the current execution attempt'
      using errcode = '23514';
  end if;

  new.expected_run_version := v_run_version;
  new.expected_attempt_version := v_attempt_version;
  return new;
end;
$$;

drop trigger if exists control_plane_outbox_bind_workflow_dispatch_versions on control_plane_outbox;
create trigger control_plane_outbox_bind_workflow_dispatch_versions
  before insert on control_plane_outbox
  for each row execute function boardreadyops_bind_workflow_dispatch_versions();

create or replace function boardreadyops_complete_workflow_dispatch_effect(
  p_outbox_id text,
  p_worker_id text,
  p_now timestamptz,
  p_workflow_dispatch_id text,
  p_workflow_run_url text default null
)
returns text
language plpgsql
security invoker
as $$
declare
  v_release_run_id text;
  v_execution_attempt_id text;
  v_expected_run_version bigint;
  v_expected_attempt_version bigint;
  v_transition_outcome text;
  v_transition_run_version bigint;
  v_transition_attempt_version bigint;
begin
  select control_plane_outbox.release_run_id,
         control_plane_outbox.execution_attempt_id,
         control_plane_outbox.expected_run_version,
         control_plane_outbox.expected_attempt_version
    into v_release_run_id,
         v_execution_attempt_id,
         v_expected_run_version,
         v_expected_attempt_version
    from control_plane_outbox
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.effect_type = 'github.workflow.dispatch'
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id
   for update;

  if v_release_run_id is null
    or v_execution_attempt_id is null
    or v_expected_run_version is null
    or v_expected_attempt_version is null
  then
    return 'stale';
  end if;

  select transition_outcome, run_version, attempt_version
    into v_transition_outcome, v_transition_run_version, v_transition_attempt_version
    from boardreadyops_transition_release_run_state(
      v_release_run_id,
      'queued',
      v_expected_run_version,
      v_execution_attempt_id,
      'dispatched',
      'workflow_dispatch_completed',
      p_now,
      'dispatching',
      v_expected_attempt_version,
      'dispatched'
    );

  if v_transition_outcome <> 'applied'
    or v_transition_run_version is null
    or v_transition_attempt_version is null
  then
    return 'stale';
  end if;

  update release_run_attempts
     set dispatched_at = coalesce(release_run_attempts.dispatched_at, p_now),
         github_workflow_dispatch_id = coalesce(
           release_run_attempts.github_workflow_dispatch_id,
           p_workflow_dispatch_id
         )
   where release_run_attempts.id = v_execution_attempt_id
     and release_run_attempts.run_id = v_release_run_id
     and release_run_attempts.status = 'dispatched'
     and release_run_attempts.version = v_transition_attempt_version;

  if not found then
    raise exception 'workflow dispatch metadata target changed after guarded transition'
      using errcode = '40001';
  end if;

  update control_plane_outbox
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = p_now,
         external_result = jsonb_strip_nulls(
           jsonb_build_object(
             'workflowDispatchId', p_workflow_dispatch_id,
             'workflowRunUrl', p_workflow_run_url
           )
         ),
         last_error_class = null,
         last_error_message = null
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id;

  if not found then
    raise exception 'workflow dispatch outbox lease changed after guarded transition'
      using errcode = '40001';
  end if;

  return 'completed';
end;
$$;
