-- Bind Check Run creation effects to the release-run version that was
-- authoritative when the effect was created, then guard every durable
-- completion branch against that immutable expectation.

alter table control_plane_outbox
  drop constraint if exists control_plane_outbox_workflow_dispatch_version_binding;

update control_plane_outbox
   set expected_run_version = release_runs.version,
       expected_attempt_version = null
  from release_runs
 where control_plane_outbox.effect_type = 'github.check_run.create'
   and control_plane_outbox.release_run_id = release_runs.id
   and control_plane_outbox.expected_run_version is null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'control_plane_outbox_effect_version_binding'
  ) then
    alter table control_plane_outbox
      add constraint control_plane_outbox_effect_version_binding
      check (
        (
          effect_type = 'github.check_run.create'
          and release_run_id is not null
          and execution_attempt_id is null
          and expected_run_version is not null
          and expected_attempt_version is null
        )
        or (
          effect_type = 'github.workflow.dispatch'
          and release_run_id is not null
          and execution_attempt_id is not null
          and expected_run_version is not null
          and expected_attempt_version is not null
        )
        or (
          effect_type not in ('github.check_run.create', 'github.workflow.dispatch')
          and expected_run_version is null
          and expected_attempt_version is null
        )
      ) not valid;
  end if;
end;
$$;

alter table control_plane_outbox
  validate constraint control_plane_outbox_effect_version_binding;

create or replace function boardreadyops_bind_control_plane_outbox_versions()
returns trigger
language plpgsql
as $$
declare
  v_run_version bigint;
  v_attempt_version bigint;
begin
  select existing.expected_run_version, existing.expected_attempt_version
    into v_run_version, v_attempt_version
    from control_plane_outbox existing
   where existing.idempotency_key = new.idempotency_key;

  if found then
    new.expected_run_version := v_run_version;
    new.expected_attempt_version := v_attempt_version;
    return new;
  end if;

  if new.effect_type = 'github.check_run.create' then
    if new.release_run_id is null or new.execution_attempt_id is not null then
      raise exception 'Check Run creation effect requires only a release run'
        using errcode = '23514';
    end if;

    select release_runs.version
      into v_run_version
      from release_runs
     where release_runs.id = new.release_run_id;

    if not found then
      raise exception 'Check Run creation effect release run was not found'
        using errcode = '23503';
    end if;

    new.expected_run_version := v_run_version;
    new.expected_attempt_version := null;
    return new;
  end if;

  if new.effect_type = 'github.workflow.dispatch' then
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
  end if;

  new.expected_run_version := null;
  new.expected_attempt_version := null;
  return new;
end;
$$;

drop trigger if exists control_plane_outbox_bind_workflow_dispatch_versions on control_plane_outbox;
drop trigger if exists control_plane_outbox_bind_effect_versions on control_plane_outbox;
create trigger control_plane_outbox_bind_effect_versions
  before insert on control_plane_outbox
  for each row execute function boardreadyops_bind_control_plane_outbox_versions();

create or replace function boardreadyops_complete_check_run_create_effect(
  p_outbox_id text,
  p_worker_id text,
  p_now timestamptz,
  p_github_check_run_id bigint,
  p_next_outbox_id text default null,
  p_next_effect_type text default null,
  p_next_idempotency_key text default null,
  p_next_payload jsonb default null,
  p_execution_attempt_id text default null
)
returns table(
  transition_outcome text,
  next_effect_type text,
  next_outbox_id text,
  execution_attempt_id text
)
language plpgsql
security invoker
as $$
declare
  v_release_run_id text;
  v_expected_run_version bigint;
  v_run_status text;
  v_run_version bigint;
  v_current_execution_attempt_id text;
  v_persisted_check_run_id bigint;
  v_installation_id text;
  v_repository_id text;
  v_next_outbox_id text;
  v_execution_attempt_id text;
  v_transition_outcome text;
  v_transition_run_version bigint;
  v_next_attempt_number integer;
  v_new_run_version bigint;
begin
  select control_plane_outbox.release_run_id,
         control_plane_outbox.expected_run_version,
         release_runs.status,
         release_runs.version,
         release_runs.execution_attempt_id,
         release_runs.github_check_run_id,
         repositories.installation_id,
         repositories.id
    into v_release_run_id,
         v_expected_run_version,
         v_run_status,
         v_run_version,
         v_current_execution_attempt_id,
         v_persisted_check_run_id,
         v_installation_id,
         v_repository_id
    from control_plane_outbox
    join release_runs on release_runs.id = control_plane_outbox.release_run_id
    join repositories on repositories.id = release_runs.repository_id
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.effect_type = 'github.check_run.create'
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id
   for update of control_plane_outbox, release_runs;

  if v_release_run_id is null
    or v_expected_run_version is null
    or v_run_version is distinct from v_expected_run_version
  then
    return query select 'stale'::text, null::text, null::text, null::text;
    return;
  end if;

  if v_persisted_check_run_id is not null
    and v_persisted_check_run_id is distinct from p_github_check_run_id
  then
    update control_plane_outbox
       set status = 'reconciliation_required',
           lease_owner = null,
           lease_expires_at = null,
           completed_at = p_now,
           external_result = jsonb_build_object('ensuredGitHubCheckRunId', p_github_check_run_id),
           last_error_class = 'check_run_conflict',
           last_error_message = 'The persisted Check Run ID differs from the idempotently ensured GitHub Check Run.'
     where control_plane_outbox.id = p_outbox_id
       and control_plane_outbox.status = 'leased'
       and control_plane_outbox.lease_owner = p_worker_id;

    return query select 'check_run_conflict'::text, null::text, null::text, null::text;
    return;
  end if;

  if p_next_effect_type = 'github.workflow.dispatch' then
    if p_next_outbox_id is null
      or p_next_idempotency_key is null
      or p_next_payload is null
      or p_execution_attempt_id is null
    then
      raise exception 'workflow dispatch transition requires next effect identity and execution attempt';
    end if;

    if v_run_status <> 'queued' or v_current_execution_attempt_id is not null then
      return query select 'stale'::text, null::text, null::text, null::text;
      return;
    end if;

    select coalesce(max(release_run_attempts.attempt_number), 0) + 1
      into strict v_next_attempt_number
      from release_run_attempts
     where release_run_attempts.run_id = v_release_run_id;

    insert into release_run_attempts (
      id,
      run_id,
      attempt_number,
      status,
      version,
      created_at,
      dispatch_requested_at
    ) values (
      p_execution_attempt_id,
      v_release_run_id,
      v_next_attempt_number,
      'dispatching',
      0,
      p_now,
      p_now
    );

    update release_runs
       set execution_attempt_id = p_execution_attempt_id,
           execution_attempt_started_at = p_now,
           github_check_run_id = coalesce(release_runs.github_check_run_id, p_github_check_run_id),
           version = release_runs.version + 1
     where release_runs.id = v_release_run_id
       and release_runs.status = 'queued'
       and release_runs.version = v_expected_run_version
       and release_runs.execution_attempt_id is null
       and (
         release_runs.github_check_run_id is null
         or release_runs.github_check_run_id = p_github_check_run_id
       )
    returning release_runs.version into v_new_run_version;

    if v_new_run_version is null then
      raise exception 'Check Run dispatch binding changed after it was locked'
        using errcode = '40001';
    end if;

    insert into release_run_transition_events (
      installation_id,
      repository_id,
      release_run_id,
      execution_attempt_id,
      entity_type,
      from_status,
      to_status,
      from_version,
      to_version,
      reason_code,
      occurred_at
    ) values (
      v_installation_id,
      v_repository_id,
      v_release_run_id,
      null,
      'release_run',
      'queued',
      'queued',
      v_expected_run_version,
      v_new_run_version,
      'check_run_dispatch_attempt_bound',
      p_now
    );

    insert into control_plane_outbox (
      id,
      release_run_id,
      execution_attempt_id,
      effect_type,
      payload_version,
      idempotency_key,
      payload,
      priority,
      status,
      available_at,
      attempt_count,
      max_attempts,
      created_at
    ) values (
      p_next_outbox_id,
      v_release_run_id,
      p_execution_attempt_id,
      'github.workflow.dispatch',
      1,
      p_next_idempotency_key,
      p_next_payload,
      60,
      'available',
      p_now,
      0,
      8,
      p_now
    )
    on conflict (idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
    returning control_plane_outbox.id, control_plane_outbox.execution_attempt_id
      into v_next_outbox_id, v_execution_attempt_id;
  elsif p_next_effect_type = 'github.check_run.complete' then
    if p_next_outbox_id is null or p_next_idempotency_key is null or p_next_payload is null then
      raise exception 'check run completion transition requires next effect identity';
    end if;

    if v_run_status <> 'queued' or v_current_execution_attempt_id is not null then
      return query select 'stale'::text, null::text, null::text, null::text;
      return;
    end if;

    select transitioned.transition_outcome, transitioned.run_version
      into v_transition_outcome, v_transition_run_version
      from boardreadyops_transition_release_run_state(
        v_release_run_id,
        'queued',
        v_expected_run_version,
        null,
        'completed',
        'check_run_safe_mode_completed',
        p_now
      ) as transitioned;

    if v_transition_outcome <> 'applied' or v_transition_run_version is null then
      return query select 'stale'::text, null::text, null::text, null::text;
      return;
    end if;

    update release_runs
       set github_check_run_id = coalesce(release_runs.github_check_run_id, p_github_check_run_id),
           decision = 'neutral'
     where release_runs.id = v_release_run_id
       and release_runs.status = 'completed'
       and release_runs.version = v_transition_run_version
       and (
         release_runs.github_check_run_id is null
         or release_runs.github_check_run_id = p_github_check_run_id
       );

    if not found then
      raise exception 'safe-mode Check Run metadata changed after guarded transition'
        using errcode = '40001';
    end if;

    insert into control_plane_outbox (
      id,
      release_run_id,
      effect_type,
      payload_version,
      idempotency_key,
      payload,
      priority,
      status,
      available_at,
      attempt_count,
      max_attempts,
      created_at
    ) values (
      p_next_outbox_id,
      v_release_run_id,
      'github.check_run.complete',
      1,
      p_next_idempotency_key,
      p_next_payload,
      40,
      'available',
      p_now,
      0,
      8,
      p_now
    )
    on conflict (idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
    returning control_plane_outbox.id into v_next_outbox_id;
  elsif p_next_effect_type is null then
    if v_run_status <> 'queued' or v_current_execution_attempt_id is not null then
      return query select 'stale'::text, null::text, null::text, null::text;
      return;
    end if;

    update release_runs
       set github_check_run_id = coalesce(release_runs.github_check_run_id, p_github_check_run_id)
     where release_runs.id = v_release_run_id
       and release_runs.status = 'queued'
       and release_runs.version = v_expected_run_version
       and release_runs.execution_attempt_id is null
       and (
         release_runs.github_check_run_id is null
         or release_runs.github_check_run_id = p_github_check_run_id
       );

    if not found then
      raise exception 'runner-disabled Check Run metadata changed after it was locked'
        using errcode = '40001';
    end if;
  else
    raise exception 'unsupported next outbox effect type: %', p_next_effect_type;
  end if;

  update control_plane_outbox
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = p_now,
         external_result = jsonb_build_object('githubCheckRunId', p_github_check_run_id),
         last_error_class = null,
         last_error_message = null
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id;

  if not found then
    raise exception 'Check Run creation outbox lease changed after guarded transition'
      using errcode = '40001';
  end if;

  return query
  select 'completed'::text, p_next_effect_type, v_next_outbox_id, v_execution_attempt_id;
end;
$$;
