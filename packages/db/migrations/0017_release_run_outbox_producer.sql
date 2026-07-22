create or replace function boardreadyops_enqueue_release_run_with_outbox(
  p_github_repo_id bigint,
  p_pull_request_number integer,
  p_commit_sha text,
  p_ref text,
  p_trigger_kind text,
  p_github_installation_id bigint,
  p_now timestamptz,
  p_run_id text,
  p_release_idempotency_key text,
  p_outbox_id text,
  p_outbox_payload jsonb
)
returns table(
  run_id text,
  release_idempotency_key text,
  run_status text,
  outbox_id text
)
language plpgsql
security invoker
as $$
declare
  v_run_id text;
  v_run_status text;
  v_check_run_id bigint;
  v_outbox_id text;
  v_outbox_idempotency_key text;
  v_outbox_payload jsonb;
begin
  with superseded_runs as (
    update release_runs
       set status = 'superseded',
           completed_at = coalesce(completed_at, p_now)
      from repositories
     where release_runs.repository_id = repositories.id
       and repositories.github_repo_id = p_github_repo_id
       and release_runs.pull_request_number = p_pull_request_number
       and release_runs.commit_sha <> p_commit_sha
       and release_runs.status in ('queued', 'dispatched', 'running')
    returning release_runs.id
  )
  update release_run_attempts
     set status = 'superseded',
         completed_at = coalesce(completed_at, p_now),
         failure_class = coalesce(failure_class, 'newer_commit'),
         failure_message = coalesce(
           failure_message,
           'A newer commit superseded this execution attempt.'
         )
   where release_run_attempts.run_id in (select superseded_runs.id from superseded_runs)
     and release_run_attempts.status in (
       'queued',
       'dispatching',
       'dispatched',
       'in_progress',
       'uploading_artifacts',
       'reporting'
     );

  insert into release_runs (
    id,
    repository_id,
    idempotency_key,
    commit_sha,
    ref,
    pull_request_number,
    trigger_kind,
    status,
    started_at
  )
  select
    p_run_id,
    repositories.id,
    p_release_idempotency_key,
    p_commit_sha,
    p_ref,
    p_pull_request_number,
    p_trigger_kind,
    'queued',
    p_now
  from repositories
  join installations on installations.id = repositories.installation_id
  where repositories.github_repo_id = p_github_repo_id
    and installations.github_installation_id = p_github_installation_id
  on conflict (idempotency_key)
  do update set status = release_runs.status
  returning release_runs.id, release_runs.status, release_runs.github_check_run_id
    into v_run_id, v_run_status, v_check_run_id;

  if v_run_id is null then
    return;
  end if;

  v_outbox_idempotency_key := 'github.check_run.create:' || v_run_id;
  v_outbox_payload := jsonb_set(p_outbox_payload, '{runId}', to_jsonb(v_run_id), true);

  if v_check_run_id is null then
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
      p_outbox_id,
      v_run_id,
      'github.check_run.create',
      1,
      v_outbox_idempotency_key,
      v_outbox_payload,
      50,
      'available',
      p_now,
      0,
      8,
      p_now
    )
    on conflict (idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
    returning control_plane_outbox.id into v_outbox_id;
  else
    select control_plane_outbox.id
      into v_outbox_id
      from control_plane_outbox
     where control_plane_outbox.idempotency_key = v_outbox_idempotency_key;
  end if;

  return query
  select v_run_id, p_release_idempotency_key, v_run_status, v_outbox_id;
end;
$$;
