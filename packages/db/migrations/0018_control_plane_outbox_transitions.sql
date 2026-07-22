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
  v_next_outbox_id text;
  v_execution_attempt_id text;
begin
  select control_plane_outbox.release_run_id
    into v_release_run_id
    from control_plane_outbox
    join release_runs on release_runs.id = control_plane_outbox.release_run_id
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.effect_type = 'github.check_run.create'
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id
   for update of control_plane_outbox, release_runs;

  if v_release_run_id is null then
    return query select 'stale'::text, null::text, null::text, null::text;
    return;
  end if;

  update release_runs
     set github_check_run_id = coalesce(release_runs.github_check_run_id, p_github_check_run_id)
   where release_runs.id = v_release_run_id
     and (
       release_runs.github_check_run_id is null
       or release_runs.github_check_run_id = p_github_check_run_id
     );

  if not found then
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

    with target as materialized (
      select release_runs.id, release_runs.execution_attempt_id
        from release_runs
       where release_runs.id = v_release_run_id
         and release_runs.status = 'queued'
       for update
    ),
    failed_previous as (
      update release_run_attempts
         set status = 'failed',
             completed_at = coalesce(release_run_attempts.completed_at, p_now),
             failure_class = coalesce(release_run_attempts.failure_class, 'dispatch_replaced'),
             failure_message = coalesce(
               release_run_attempts.failure_message,
               'A newer dispatch attempt replaced this uncompleted attempt.'
             )
        from target
       where release_run_attempts.id = target.execution_attempt_id
         and release_run_attempts.status in ('queued', 'dispatching')
      returning release_run_attempts.id
    ),
    numbered as (
      select target.id as run_id,
             coalesce(max(release_run_attempts.attempt_number), 0) + 1 as attempt_number
        from target
        left join release_run_attempts on release_run_attempts.run_id = target.id
       group by target.id
    ),
    inserted_attempt as (
      insert into release_run_attempts (
        id,
        run_id,
        attempt_number,
        status,
        created_at,
        dispatch_requested_at
      )
      select p_execution_attempt_id,
             numbered.run_id,
             numbered.attempt_number,
             'dispatching',
             p_now,
             p_now
        from numbered
      returning release_run_attempts.id, release_run_attempts.run_id
    ),
    updated_run as (
      update release_runs
         set execution_attempt_id = inserted_attempt.id,
             execution_attempt_started_at = p_now
        from inserted_attempt
       where release_runs.id = inserted_attempt.run_id
      returning release_runs.id, inserted_attempt.id as execution_attempt_id
    )
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
    )
    select p_next_outbox_id,
           updated_run.id,
           updated_run.execution_attempt_id,
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
      from updated_run
    on conflict (idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
    returning control_plane_outbox.id, control_plane_outbox.execution_attempt_id
      into v_next_outbox_id, v_execution_attempt_id;
  elsif p_next_effect_type = 'github.check_run.complete' then
    if p_next_outbox_id is null or p_next_idempotency_key is null or p_next_payload is null then
      raise exception 'check run completion transition requires next effect identity';
    end if;

    update release_runs
       set status = 'completed',
           decision = 'neutral',
           completed_at = coalesce(release_runs.completed_at, p_now),
           duration_ms = case
             when release_runs.completed_at is null
               then greatest(0, floor(extract(epoch from (p_now - release_runs.started_at)) * 1000))::integer
             else release_runs.duration_ms
           end
     where release_runs.id = v_release_run_id
       and release_runs.status = 'queued';

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
  elsif p_next_effect_type is not null then
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
    return query select 'stale'::text, null::text, null::text, null::text;
    return;
  end if;

  return query
  select 'completed'::text, p_next_effect_type, v_next_outbox_id, v_execution_attempt_id;
end;
$$;

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
begin
  select control_plane_outbox.release_run_id, control_plane_outbox.execution_attempt_id
    into v_release_run_id, v_execution_attempt_id
    from control_plane_outbox
   where control_plane_outbox.id = p_outbox_id
     and control_plane_outbox.effect_type = 'github.workflow.dispatch'
     and control_plane_outbox.status = 'leased'
     and control_plane_outbox.lease_owner = p_worker_id
   for update;

  if v_release_run_id is null or v_execution_attempt_id is null then
    return 'stale';
  end if;

  with updated_attempt as (
    update release_run_attempts
       set status = 'dispatched',
           dispatched_at = coalesce(release_run_attempts.dispatched_at, p_now),
           github_workflow_dispatch_id = coalesce(
             release_run_attempts.github_workflow_dispatch_id,
             p_workflow_dispatch_id
           )
      from release_runs
     where release_run_attempts.id = v_execution_attempt_id
       and release_run_attempts.run_id = v_release_run_id
       and release_run_attempts.status = 'dispatching'
       and release_runs.id = release_run_attempts.run_id
       and release_runs.execution_attempt_id = release_run_attempts.id
       and release_runs.status = 'queued'
    returning release_run_attempts.id, release_run_attempts.run_id
  )
  update release_runs
     set status = 'dispatched'
    from updated_attempt
   where release_runs.id = updated_attempt.run_id
     and release_runs.execution_attempt_id = updated_attempt.id
     and release_runs.status = 'queued';

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
    return 'stale';
  end if;

  return 'completed';
end;
$$;
