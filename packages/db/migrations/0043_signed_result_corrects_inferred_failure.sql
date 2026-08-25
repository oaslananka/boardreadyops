-- Let a signed result correct a verdict that was only inferred.
--
-- When reconciliation observes a dispatched GitHub workflow fail, it has no result to report,
-- so it terminalises the run and publishes "release blocked". That is the best available answer
-- at the time. But GitHub re-runs a workflow under the same run id as a new attempt, and when
-- that attempt succeeds it posts a genuine OIDC-signed result for the same execution attempt.
-- Until now that result was rejected as conflicting_terminal_result, so the pull request kept a
-- blocking Check Run for a board that had actually passed. That is the worst failure this
-- product has: a wrong verdict on someone's hardware release.
--
-- Observed on oaslananka/boardreadyops-canary-personal, where attempt 1 of a dispatched run
-- failed in two seconds without ever being assigned a runner (an Actions quota rejection:
-- runner_name empty, zero steps) and attempt 2 later ran the readiness job to success.
--
-- The relaxation is narrow and gated on one condition: the run holds no terminal_result_digest,
-- which is true only when it was failed by inference rather than by a reported result. Every
-- other guard is unchanged - supersession, stale attempts, artifact integrity and signature
-- verification are all classified before this point, and a run that did report a result keeps
-- its verdict.

create or replace function boardreadyops_apply_runner_result_state(
  p_release_run_id text,
  p_apply boolean,
  p_expected_run_status text,
  p_expected_run_version bigint,
  p_expected_execution_attempt_id text,
  p_expected_attempt_status text,
  p_expected_attempt_version bigint,
  p_result_status text,
  p_decision text,
  p_received_at timestamptz,
  p_terminal_result_digest text,
  p_result_digest text
)
returns table(
  transition_outcome text,
  run_status text,
  run_version bigint,
  attempt_status text,
  attempt_version bigint,
  run_changed boolean,
  attempt_changed boolean
)
language plpgsql
security invoker
as $$
declare
  v_run release_runs%rowtype;
  v_attempt release_run_attempts%rowtype;
  v_installation_id text;
  v_repository_id text;
  v_next_run_status text;
  v_next_attempt_status text;
  v_run_to_version bigint;
  v_attempt_to_version bigint;
  v_run_changed boolean := false;
  v_attempt_changed boolean := false;
  v_terminal boolean;
  v_corrects_inferred_failure boolean;
begin
  if not p_apply then
    return query
    select 'skipped'::text, null::text, null::bigint, null::text, null::bigint, false, false;
    return;
  end if;

  select release_runs.*
    into v_run
    from release_runs
   where release_runs.id = p_release_run_id
   for update of release_runs;

  if v_run.id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, null::text, null::bigint, false, false;
    return;
  end if;

  select repositories.installation_id, repositories.id
    into v_installation_id, v_repository_id
    from repositories
   where repositories.id = v_run.repository_id;

  if v_installation_id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, null::text, null::bigint, false, false;
    return;
  end if;

  if v_run.status is distinct from p_expected_run_status
    or v_run.version is distinct from p_expected_run_version
    or v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id
  then
    return query
    select 'stale'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
    return;
  end if;

  if p_expected_run_version < 0
    or p_result_status not in ('queued', 'running', 'completed', 'failed', 'timed_out')
    or p_result_digest is null
    or p_result_digest !~ '^[0-9a-f]{64}$'
    or (p_decision is not null and p_decision not in ('pass', 'fail', 'error'))
  then
    return query
    select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
    return;
  end if;

  v_terminal := p_result_status in ('completed', 'failed', 'timed_out');

  -- A run that reached a terminal state without ever recording a result digest was failed by
  -- inference: reconciliation observed the GitHub workflow fail and had to guess a verdict.
  -- A signed result for the still-current attempt is stronger evidence than that guess, so it
  -- is allowed to correct the verdict. A run that did record a digest reported a real result
  -- and stays immutable - genuine failures cannot be overwritten this way.
  v_corrects_inferred_failure :=
    v_terminal
    and v_run.terminal_result_digest is null
    and v_run.status in ('completed', 'failed', 'timed_out');

  if (v_terminal and (p_terminal_result_digest is null or p_terminal_result_digest !~ '^[0-9a-f]{64}$'))
    or (not v_terminal and p_terminal_result_digest is not null)
  then
    return query
    select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
    return;
  end if;

  if p_expected_execution_attempt_id is null then
    if p_expected_attempt_status is not null or p_expected_attempt_version is not null then
      return query
      select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
      return;
    end if;
  else
    if p_expected_attempt_status is null
      or p_expected_attempt_version is null
      or p_expected_attempt_version < 0
    then
      return query
      select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
      return;
    end if;

    select release_run_attempts.*
      into v_attempt
      from release_run_attempts
     where release_run_attempts.id = p_expected_execution_attempt_id
       and release_run_attempts.run_id = p_release_run_id
     for update of release_run_attempts;

    if v_attempt.id is null then
      return query
      select 'not_found'::text, v_run.status, v_run.version, null::text, null::bigint, false, false;
      return;
    end if;

    if v_attempt.status is distinct from p_expected_attempt_status
      or v_attempt.version is distinct from p_expected_attempt_version
    then
      return query
      select 'stale'::text, v_run.status, v_run.version, v_attempt.status, v_attempt.version, false, false;
      return;
    end if;
  end if;

  v_next_run_status := p_result_status;
  v_next_attempt_status := case
    when p_result_status = 'queued' then 'dispatching'
    when p_result_status = 'running' then 'in_progress'
    else p_result_status
  end;

  if (
    p_result_status = 'queued'
    and v_run.status not in ('queued', 'reconciliation_required')
  ) or (
    p_result_status = 'running'
    and v_run.status not in ('queued', 'dispatched', 'running', 'reconciliation_required')
  ) or (
    v_terminal
    and v_run.status not in ('queued', 'dispatched', 'running', 'reconciliation_required')
    and not v_corrects_inferred_failure
  ) then
    return query
    select 'invalid_transition'::text,
           v_run.status,
           v_run.version,
           v_attempt.status,
           v_attempt.version,
           false,
           false;
    return;
  end if;

  if v_attempt.id is not null and (
    (
      v_next_attempt_status = 'dispatching'
      and v_attempt.status not in ('queued', 'dispatching')
    ) or (
      v_next_attempt_status = 'in_progress'
      and v_attempt.status not in ('queued', 'dispatching', 'dispatched', 'in_progress')
    ) or (
      v_terminal
      and not (
        v_attempt.status in ('queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting')
        or v_attempt.status = v_next_attempt_status
        or v_corrects_inferred_failure
      )
    )
  ) then
    return query
    select 'invalid_transition'::text,
           v_run.status,
           v_run.version,
           v_attempt.status,
           v_attempt.version,
           false,
           false;
    return;
  end if;

  v_run_changed := v_next_run_status is distinct from v_run.status;
  v_attempt_changed := v_attempt.id is not null and v_next_attempt_status is distinct from v_attempt.status;
  v_run_to_version := v_run.version + case when v_run_changed then 1 else 0 end;

  update release_runs
     set status = v_next_run_status,
         version = v_run_to_version,
         decision = p_decision,
         completed_at = case
           when v_terminal then coalesce(release_runs.completed_at, p_received_at)
           else release_runs.completed_at
         end,
         duration_ms = case
           when v_terminal and release_runs.duration_ms is null
             then greatest(
               0,
               floor(
                 extract(epoch from (coalesce(release_runs.completed_at, p_received_at) - release_runs.started_at)) * 1000
               )::integer
             )
           else release_runs.duration_ms
         end,
         terminal_result_digest = case
           when v_terminal then p_terminal_result_digest
           else release_runs.terminal_result_digest
         end
   where release_runs.id = p_release_run_id
     and release_runs.status = p_expected_run_status
     and release_runs.version = p_expected_run_version
     and release_runs.execution_attempt_id is not distinct from p_expected_execution_attempt_id;

  if not found then
    raise exception 'release run changed after runner result validation'
      using errcode = '40001';
  end if;

  if v_attempt.id is not null then
    v_attempt_to_version := v_attempt.version + case when v_attempt_changed then 1 else 0 end;

    update release_run_attempts
       set status = v_next_attempt_status,
           version = v_attempt_to_version,
           started_at = case
             when p_result_status in ('running', 'completed', 'failed', 'timed_out')
               then coalesce(release_run_attempts.started_at, p_received_at)
             else release_run_attempts.started_at
           end,
           heartbeat_at = p_received_at,
           completed_at = case
             when v_terminal then coalesce(release_run_attempts.completed_at, p_received_at)
             else release_run_attempts.completed_at
           end,
           result_digest = case
             when v_terminal then p_result_digest
             else release_run_attempts.result_digest
           end
     where release_run_attempts.id = p_expected_execution_attempt_id
       and release_run_attempts.run_id = p_release_run_id
       and release_run_attempts.status = p_expected_attempt_status
       and release_run_attempts.version = p_expected_attempt_version;

    if not found then
      raise exception 'release-run attempt changed after runner result validation'
        using errcode = '40001';
    end if;
  end if;

  if v_run_changed then
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
      v_next_run_status,
      v_run.version,
      v_run_to_version,
      'runner_result_' || p_result_status,
      p_received_at
    );
  end if;

  if v_attempt_changed then
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
      v_next_attempt_status,
      v_attempt.version,
      v_attempt_to_version,
      'runner_result_' || p_result_status,
      p_received_at
    );
  end if;

  return query
  select 'applied'::text,
         v_next_run_status,
         v_run_to_version,
         case when v_attempt.id is null then null else v_next_attempt_status end,
         case when v_attempt.id is null then null else v_attempt_to_version end,
         v_run_changed,
         v_attempt_changed;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0043_signed_result_corrects_inferred_failure')
on conflict (version) do nothing;
