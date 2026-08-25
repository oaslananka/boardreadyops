-- Complete the Check Run for a terminal run that never reported a result.
--
-- Check Run reconciliation was written for one failure mode: a signed terminal result was
-- accepted but publishing the Check Run to GitHub failed. All three of its functions therefore
-- joined release_run_results, so a run that reached a terminal state *without ever producing a
-- result* was invisible to every one of them.
--
-- That is not a rare corner. A dispatched workflow that never starts -- Actions disabled, an
-- Actions budget block, a runner that never claims the job -- produces no callback, so the
-- lifecycle marks the run failed while its Check Run stays "in progress" on the pull request
-- forever. As a required check it blocks the merge permanently, and it does so silently: the
-- control plane knows the run failed and simply never tells GitHub.
--
-- These runs now reconcile too, concluded from the run's own terminal status rather than from a
-- result that does not exist. Everything else here is migration 0021 unchanged.

create or replace function boardreadyops_detect_github_check_run_reconciliation(
  p_now timestamptz,
  p_observation_delay_seconds integer,
  p_terminal_deadline_seconds integer,
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_detected integer;
begin
  if p_observation_delay_seconds <= 0 or p_terminal_deadline_seconds <= 0 or p_limit <= 0 then
    raise exception 'Check Run reconciliation intervals and limit must be positive' using errcode = '22023';
  end if;
  if p_terminal_deadline_seconds <= p_observation_delay_seconds then
    raise exception 'Check Run reconciliation deadline must exceed observation delay' using errcode = '22023';
  end if;

  with candidates as (
    select
      gen_random_uuid()::text as reconciliation_id,
      installations.id as installation_id,
      repositories.id as repository_id,
      release_runs.id as release_run_id,
      coalesce(
        release_run_results.last_publication_attempt_at,
        release_run_results.received_at,
        -- No result row at all: the run's own completion is the only observation point.
        release_runs.completed_at
      ) as observed_from
    from release_runs
    -- Left joined so a terminal run that never reported is still a candidate. An inner join
    -- here is precisely what hid these runs.
    left join release_run_results on release_run_results.run_id = release_runs.id
    join repositories on repositories.id = release_runs.repository_id
    join installations on installations.id = repositories.installation_id
    where (release_run_results.run_id is null or release_run_results.github_check_published_at is null)
      and release_runs.github_check_run_id is not null
      and release_runs.status in ('completed', 'failed', 'timed_out')
      and coalesce(
            release_run_results.last_publication_attempt_at,
            release_run_results.received_at,
            release_runs.completed_at
          ) is not null
      and coalesce(
            release_run_results.last_publication_attempt_at,
            release_run_results.received_at,
            release_runs.completed_at
          ) <= p_now - make_interval(secs => p_observation_delay_seconds)
      and not exists (
        select 1
        from control_plane_reconciliation_items existing
        where existing.installation_id = installations.id
          and existing.subject_type = 'release_run'
          and existing.subject_id = release_runs.id
          and existing.reason_code = 'reporting_stale'
      )
    order by observed_from asc, release_runs.id asc
    limit greatest(1, least(p_limit, 1000))
  ), inserted as (
    insert into control_plane_reconciliation_items (
      id,
      installation_id,
      repository_id,
      release_run_id,
      subject_type,
      subject_id,
      reason_code,
      status,
      deadline_at,
      next_check_at,
      attempt_count,
      max_attempts,
      created_at
    )
    select
      candidates.reconciliation_id,
      candidates.installation_id,
      candidates.repository_id,
      candidates.release_run_id,
      'release_run',
      candidates.release_run_id,
      'reporting_stale',
      'available',
      candidates.observed_from + make_interval(secs => p_terminal_deadline_seconds),
      p_now,
      0,
      12,
      p_now
    from candidates
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_detected from inserted;

  return coalesce(v_detected, 0);
end;
$$;

-- Adding an output column changes the row type, which "create or replace" refuses. The migration
-- runner wraps each file in a transaction, so the function is never absent to a concurrent caller.
drop function if exists boardreadyops_github_check_run_reconciliation_context(text, text);

create function boardreadyops_github_check_run_reconciliation_context(
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
  commit_sha text,
  github_check_run_id bigint,
  run_status text,
  expected_conclusion text,
  completed_at timestamptz,
  deadline_at timestamptz,
  -- False when the run reached a terminal state without ever reporting a result, so the worker
  -- can say that plainly instead of claiming it restored an accepted one.
  result_reported boolean
)
language sql
security invoker
as $$
  select
    cpri.id,
    installations.id,
    installations.github_installation_id,
    repositories.id,
    repositories.owner,
    repositories.name,
    repositories.owner || '/' || repositories.name,
    release_runs.id,
    release_runs.commit_sha,
    release_runs.github_check_run_id,
    release_runs.status,
    coalesce(
      release_run_results.github_check_conclusion,
      -- Without a result the run's own terminal status is the only honest source. A run that
      -- never reported cannot be concluded successful.
      case when release_runs.status = 'timed_out' then 'timed_out' else 'failure' end
    ),
    coalesce(release_runs.completed_at, release_run_results.received_at),
    cpri.deadline_at,
    release_run_results.run_id is not null
  from control_plane_reconciliation_items cpri
  join release_runs
    on release_runs.id = cpri.release_run_id
   and release_runs.id = cpri.subject_id
  left join release_run_results on release_run_results.run_id = release_runs.id
  join repositories
    on repositories.id = release_runs.repository_id
   and repositories.id = cpri.repository_id
  join installations
    on installations.id = repositories.installation_id
   and installations.id = cpri.installation_id
  where cpri.id = p_reconciliation_id
    and cpri.status = 'leased'
    and cpri.lease_owner = p_worker_id
    and cpri.subject_type = 'release_run'
    and cpri.reason_code = 'reporting_stale'
    and release_runs.status in ('completed', 'failed', 'timed_out')
    and release_runs.github_check_run_id is not null
    and (release_run_results.run_id is null or release_run_results.github_check_published_at is null);
$$;

create or replace function boardreadyops_apply_github_check_run_reconciliation(
  p_reconciliation_id text,
  p_worker_id text,
  p_now timestamptz,
  p_observed_status text,
  p_observed_conclusion text,
  p_action text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_locked record;
  v_item control_plane_reconciliation_items%rowtype;
  v_run release_runs%rowtype;
  v_result release_run_results%rowtype;
  v_has_result boolean;
  v_outcome text;
  v_outcome_code text;
begin
  if p_observed_status !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or (p_observed_conclusion is not null and p_observed_conclusion !~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
     or p_action not in ('observed_current', 'updated') then
    raise exception 'invalid Check Run reconciliation observation' using errcode = '22023';
  end if;

  -- The result is locked separately rather than joined in: Postgres refuses FOR UPDATE on the
  -- nullable side of an outer join, and a run that never reported has no result row to lock.
  select cpri as item, rr as run
  into v_locked
  from control_plane_reconciliation_items cpri
  join release_runs rr
    on rr.id = cpri.release_run_id
   and rr.id = cpri.subject_id
  where cpri.id = p_reconciliation_id
    and cpri.status = 'leased'
    and cpri.lease_owner = p_worker_id
    and cpri.subject_type = 'release_run'
    and cpri.reason_code = 'reporting_stale'
    and rr.status in ('completed', 'failed', 'timed_out')
    and rr.github_check_run_id is not null
  -- for update of control_plane_reconciliation_items, release_runs
  for update of cpri, rr;

  if not found then
    return 'stale';
  end if;

  v_item := v_locked.item;
  v_run := v_locked.run;

  select * into v_result from release_run_results where run_id = v_run.id for update;
  v_has_result := found;

  if v_has_result and v_result.github_check_published_at is not null then
    v_outcome := 'already_published';
    v_outcome_code := 'already_published';
  elsif v_has_result then
    update release_run_results
    set github_check_published_at = coalesce(github_check_published_at, p_now),
        last_publication_attempt_at = p_now,
        last_publication_error = null
    where run_id = v_run.id
      and github_check_published_at is null;

    if not found then
      raise exception 'Check Run publication state changed while leased' using errcode = '40001';
    end if;
    v_outcome := 'applied';
    v_outcome_code := 'github_check_run_reconciled';
  else
    -- Nothing to mark published: the run reached a terminal state without ever reporting. The
    -- Check Run itself has still been completed on GitHub, which is what this item existed for.
    v_outcome := 'applied';
    v_outcome_code := 'github_check_run_reconciled_without_result';
  end if;

  update control_plane_reconciliation_items
  set status = 'completed',
      lease_owner = null,
      lease_expires_at = null,
      completed_at = p_now,
      outcome_code = v_outcome_code,
      repaired = v_outcome = 'applied',
      public_failure_reason = null,
      last_error_class = null,
      last_error_message = null
  where id = v_item.id
    and status = 'leased'
    and lease_owner = p_worker_id;

  if not found then
    raise exception 'Check Run reconciliation lease changed while applying publication state' using errcode = '40001';
  end if;

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    metadata, created_at
  ) values (
    gen_random_uuid()::text,
    v_item.installation_id,
    'control_plane.github_check_run_reconciled',
    'system',
    p_worker_id,
    'release_run',
    v_run.id,
    v_item.repository_id,
    v_run.id,
    jsonb_strip_nulls(jsonb_build_object(
      'reconciliationId', v_item.id,
      'reasonCode', v_item.reason_code,
      'checkRunId', v_run.github_check_run_id,
      'observedStatus', p_observed_status,
      'observedConclusion', p_observed_conclusion,
      'expectedConclusion', v_result.github_check_conclusion,
      'resultReported', v_has_result,
      'action', p_action,
      'outcome', v_outcome
    )),
    p_now
  );

  return v_outcome;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0042_check_run_reconciliation_without_result')
on conflict (version) do nothing;
