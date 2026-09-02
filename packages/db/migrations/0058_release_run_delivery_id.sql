-- Traces a release run back to the GitHub webhook delivery that created it.
-- DB-only, deliberately: the aggregate webhook-intake telemetry stream must never carry
-- delivery or tenant identifiers (see webhook-intake-telemetry.ts's own test), so this
-- correlation is queryable in the database only, never emitted to stdout logs.

alter table release_runs
  add column if not exists delivery_id text;

create index if not exists release_runs_delivery_id_idx
  on release_runs(delivery_id)
  where delivery_id is not null;

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
  p_outbox_payload jsonb,
  p_delivery_id text
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
  v_installation_id text;
  v_repository_id text;
  v_setup_revision_id text;
  v_candidate record;
  v_transition_outcome text;
  v_run_id text;
  v_run_status text;
  v_check_run_id bigint;
  v_run_inserted boolean;
  v_outbox_id text;
  v_outbox_idempotency_key text;
  v_outbox_payload jsonb;
  v_safe_mode_enabled boolean;
  v_safe_mode_reason_payload jsonb;
  v_safe_mode_reasons text[];
  v_trust_mode text;
begin
  select installations.id, repositories.id, repositories.current_setup_revision_id
    into v_installation_id, v_repository_id, v_setup_revision_id
    from repositories
    join installations on installations.id = repositories.installation_id
   where repositories.github_repo_id = p_github_repo_id
     and installations.github_installation_id = p_github_installation_id
   for key share of repositories;

  if v_repository_id is null then
    return;
  end if;

  v_safe_mode_enabled := p_outbox_payload #> '{action,safeMode,enabled}' = 'true'::jsonb;
  v_safe_mode_reason_payload := coalesce(
    p_outbox_payload #> '{action,safeMode,reasons}',
    '[]'::jsonb
  );

  if jsonb_typeof(v_safe_mode_reason_payload) <> 'array' then
    raise exception 'safe-mode reasons must be an array' using errcode = '22023';
  end if;

  v_safe_mode_reasons := array_remove(array[
    case when v_safe_mode_reason_payload ? 'draft-pull-request' then 'draft-pull-request' end,
    case when v_safe_mode_reason_payload ? 'fork-pull-request' then 'fork-pull-request' end,
    case when v_safe_mode_reason_payload ? 'private-repository' then 'private-repository' end
  ]::text[], null);

  if v_safe_mode_enabled then
    if cardinality(v_safe_mode_reasons) = 0
       or jsonb_array_length(v_safe_mode_reason_payload) <> cardinality(v_safe_mode_reasons) then
      raise exception 'safe mode requires unique supported reasons' using errcode = '22023';
    end if;
    v_trust_mode := 'safe';
  else
    if jsonb_array_length(v_safe_mode_reason_payload) <> 0 then
      raise exception 'safe-mode reasons require safe mode' using errcode = '22023';
    end if;
    v_trust_mode := 'standard';
    v_safe_mode_reasons := '{}'::text[];
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
    repository_setup_revision_id,
    idempotency_key,
    commit_sha,
    ref,
    pull_request_number,
    trigger_kind,
    trust_mode,
    safe_mode_reasons,
    status,
    started_at,
    delivery_id
  ) values (
    p_run_id,
    v_repository_id,
    v_setup_revision_id,
    p_release_idempotency_key,
    p_commit_sha,
    p_ref,
    p_pull_request_number,
    p_trigger_kind,
    v_trust_mode,
    v_safe_mode_reasons,
    'queued',
    p_now,
    p_delivery_id
  )
  on conflict (idempotency_key)
  do update set status = release_runs.status
  returning release_runs.id,
            release_runs.status,
            release_runs.github_check_run_id,
            (xmax = 0)
    into v_run_id, v_run_status, v_check_run_id, v_run_inserted;

  if v_run_id is null then
    return;
  end if;

  if v_run_inserted then
    insert into audit_events (
      id,
      installation_id,
      event_type,
      actor_type,
      subject_type,
      subject_id,
      repository_id,
      release_run_id,
      request_id,
      metadata,
      created_at
    ) values (
      gen_random_uuid()::text,
      v_installation_id,
      'release_run.trust_mode_selected',
      'github_webhook',
      'release_run',
      v_run_id,
      v_repository_id,
      v_run_id,
      p_release_idempotency_key,
      jsonb_build_object(
        'trustMode', v_trust_mode,
        'safeModeReasons', to_jsonb(v_safe_mode_reasons)
      ),
      p_now
    );
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
