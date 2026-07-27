-- Serialize release-run enqueue per repository and pull request, then move
-- every superseded logical run and its nonterminal attempts through versioned,
-- append-only lifecycle transitions.

create or replace function boardreadyops_supersede_release_run_state(
  p_release_run_id text,
  p_expected_run_status text,
  p_expected_run_version bigint,
  p_expected_execution_attempt_id text,
  p_reason_code text,
  p_now timestamptz
)
returns table(
  transition_outcome text,
  run_status text,
  run_version bigint,
  superseded_attempt_count integer
)
language plpgsql
security invoker
as $$
declare
  v_run release_runs%rowtype;
  v_attempt record;
  v_installation_id text;
  v_repository_id text;
  v_run_to_version bigint;
  v_attempt_to_version bigint;
  v_superseded_attempt_count integer := 0;
begin
  select release_runs.*
    into v_run
    from release_runs
   where release_runs.id = p_release_run_id
   for update of release_runs;

  if v_run.id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, 0::integer;
    return;
  end if;

  if v_run.status is distinct from p_expected_run_status
    or v_run.version is distinct from p_expected_run_version
    or v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id
  then
    return query
    select 'stale'::text, v_run.status, v_run.version, 0::integer;
    return;
  end if;

  if p_expected_run_version < 0
    or p_reason_code is null
    or p_reason_code is distinct from btrim(p_reason_code)
    or char_length(p_reason_code) not between 1 and 128
    or p_reason_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    or not boardreadyops_release_run_transition_allowed(v_run.status, 'superseded')
  then
    return query
    select 'invalid_transition'::text, v_run.status, v_run.version, 0::integer;
    return;
  end if;

  select repositories.installation_id, repositories.id
    into v_installation_id, v_repository_id
    from repositories
   where repositories.id = v_run.repository_id;

  if v_installation_id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, 0::integer;
    return;
  end if;

  -- Lock and validate every attempt before the first mutation. The second loop
  -- reuses the same row locks and applies exactly the snapshots validated here.
  for v_attempt in
    select release_run_attempts.id,
           release_run_attempts.status,
           release_run_attempts.version,
           release_run_attempts.attempt_number
      from release_run_attempts
     where release_run_attempts.run_id = p_release_run_id
       and release_run_attempts.status in (
         'queued',
         'dispatching',
         'dispatched',
         'in_progress',
         'uploading_artifacts',
         'reporting'
       )
     order by release_run_attempts.attempt_number, release_run_attempts.id
     for update of release_run_attempts
  loop
    if not boardreadyops_release_run_attempt_transition_allowed(v_attempt.status, 'superseded') then
      return query
      select 'invalid_transition'::text, v_run.status, v_run.version, 0::integer;
      return;
    end if;
  end loop;

  for v_attempt in
    select release_run_attempts.id,
           release_run_attempts.status,
           release_run_attempts.version,
           release_run_attempts.attempt_number
      from release_run_attempts
     where release_run_attempts.run_id = p_release_run_id
       and release_run_attempts.status in (
         'queued',
         'dispatching',
         'dispatched',
         'in_progress',
         'uploading_artifacts',
         'reporting'
       )
     order by release_run_attempts.attempt_number, release_run_attempts.id
     for update of release_run_attempts
  loop
    v_attempt_to_version := null;

    update release_run_attempts
       set status = 'superseded',
           version = release_run_attempts.version + 1,
           completed_at = coalesce(release_run_attempts.completed_at, p_now),
           failure_class = coalesce(release_run_attempts.failure_class, 'newer_commit'),
           failure_message = coalesce(
             release_run_attempts.failure_message,
             'A newer commit superseded this execution attempt.'
           )
     where release_run_attempts.id = v_attempt.id
       and release_run_attempts.run_id = p_release_run_id
       and release_run_attempts.status = v_attempt.status
       and release_run_attempts.version = v_attempt.version
    returning release_run_attempts.version into v_attempt_to_version;

    if v_attempt_to_version is null then
      raise exception 'release-run attempt changed after supersession validation'
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
      p_release_run_id,
      v_attempt.id,
      'execution_attempt',
      v_attempt.status,
      'superseded',
      v_attempt.version,
      v_attempt_to_version,
      p_reason_code,
      p_now
    );

    v_superseded_attempt_count := v_superseded_attempt_count + 1;
  end loop;

  update release_runs
     set status = 'superseded',
         version = release_runs.version + 1,
         completed_at = coalesce(release_runs.completed_at, p_now),
         duration_ms = case
           when release_runs.duration_ms is null
             then greatest(0, floor(extract(epoch from (p_now - release_runs.started_at)) * 1000))::integer
           else release_runs.duration_ms
         end
   where release_runs.id = p_release_run_id
     and release_runs.status = p_expected_run_status
     and release_runs.version = p_expected_run_version
     and release_runs.execution_attempt_id is not distinct from p_expected_execution_attempt_id
  returning release_runs.version into v_run_to_version;

  if v_run_to_version is null then
    raise exception 'release run changed after supersession validation'
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
    p_release_run_id,
    null,
    'release_run',
    v_run.status,
    'superseded',
    v_run.version,
    v_run_to_version,
    p_reason_code,
    p_now
  );

  return query
  select 'applied'::text,
         'superseded'::text,
         v_run_to_version,
         v_superseded_attempt_count;
end;
$$;

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
  v_repository_id text;
  v_candidate record;
  v_transition_outcome text;
  v_run_id text;
  v_run_status text;
  v_check_run_id bigint;
  v_outbox_id text;
  v_outbox_idempotency_key text;
  v_outbox_payload jsonb;
begin
  select repositories.id
    into v_repository_id
    from repositories
    join installations on installations.id = repositories.installation_id
   where repositories.github_repo_id = p_github_repo_id
     and installations.github_installation_id = p_github_installation_id
   for key share of repositories;

  if v_repository_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_repository_id || ':' || p_pull_request_number::text, 0)
  );

  for v_candidate in
    select release_runs.id,
           release_runs.status,
           release_runs.version,
           release_runs.execution_attempt_id
      from release_runs
     where release_runs.repository_id = v_repository_id
       and release_runs.pull_request_number = p_pull_request_number
       and release_runs.commit_sha <> p_commit_sha
       and release_runs.status in ('queued', 'dispatched', 'running')
     order by release_runs.started_at, release_runs.id
     for update of release_runs
  loop
    select superseded.transition_outcome
      into v_transition_outcome
      from boardreadyops_supersede_release_run_state(
        v_candidate.id,
        v_candidate.status,
        v_candidate.version,
        v_candidate.execution_attempt_id,
        'newer_commit',
        p_now
      ) as superseded;

    if v_transition_outcome <> 'applied' then
      raise exception 'release-run supersession changed after it was locked'
        using errcode = '40001';
    end if;
  end loop;

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
  ) values (
    p_run_id,
    v_repository_id,
    p_release_idempotency_key,
    p_commit_sha,
    p_ref,
    p_pull_request_number,
    p_trigger_kind,
    'queued',
    p_now
  )
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
