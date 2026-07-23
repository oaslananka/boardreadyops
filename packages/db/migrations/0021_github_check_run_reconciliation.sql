-- Tenant-scoped GitHub Check Run reconciliation for accepted terminal results whose publication did not converge.

alter table release_run_results
  add column if not exists github_check_conclusion text;

create or replace function boardreadyops_github_check_conclusion(
  p_status text,
  p_decision text,
  p_payload jsonb
)
returns text
language sql
immutable
security invoker
as $$
  select case
    when p_status = 'timed_out' then 'timed_out'
    when p_status = 'failed'
      or p_decision in ('fail', 'error')
      or p_payload #>> '{readiness,status}' = 'blocked'
      then 'failure'
    when p_status = 'completed' and p_decision = 'pass' then
      case
        when p_payload #>> '{readiness,status}' = 'at-risk'
          or jsonb_array_length(coalesce(p_payload #> '{readiness,warnings}', '[]'::jsonb)) > 0
          or jsonb_array_length(coalesce(p_payload #> '{waivers,active}', '[]'::jsonb)) > 0
          or jsonb_array_length(coalesce(p_payload #> '{waivers,expired}', '[]'::jsonb)) > 0
          or exists (
            select 1
            from jsonb_array_elements(coalesce(p_payload -> 'findings', '[]'::jsonb)) finding
            where finding ->> 'severity' in ('medium', 'low', 'info')
          )
          then 'neutral'
        else 'success'
      end
    else 'neutral'
  end;
$$;

create or replace function boardreadyops_set_github_check_conclusion()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.github_check_conclusion := boardreadyops_github_check_conclusion(new.status, new.decision, new.payload);
  return new;
end;
$$;

drop trigger if exists release_run_results_set_github_check_conclusion on release_run_results;
create trigger release_run_results_set_github_check_conclusion
before insert or update of status, decision, payload, github_check_conclusion
on release_run_results
for each row
execute function boardreadyops_set_github_check_conclusion();

update release_run_results
set github_check_conclusion = boardreadyops_github_check_conclusion(status, decision, payload)
where github_check_conclusion is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'release_run_results_github_check_conclusion_valid'
      and conrelid = 'release_run_results'::regclass
  ) then
    alter table release_run_results
      add constraint release_run_results_github_check_conclusion_valid
      check (github_check_conclusion in ('failure', 'neutral', 'success', 'timed_out'));
  end if;
end;
$$;

alter table release_run_results
  alter column github_check_conclusion set not null;

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
      coalesce(release_run_results.last_publication_attempt_at, release_run_results.received_at) as observed_from
    from release_run_results
    join release_runs on release_runs.id = release_run_results.run_id
    join repositories on repositories.id = release_runs.repository_id
    join installations on installations.id = repositories.installation_id
    where release_run_results.github_check_published_at is null
      and release_runs.github_check_run_id is not null
      and release_runs.status in ('completed', 'failed', 'timed_out')
      and coalesce(release_run_results.last_publication_attempt_at, release_run_results.received_at)
          <= p_now - make_interval(secs => p_observation_delay_seconds)
      and not exists (
        select 1
        from control_plane_reconciliation_items existing
        where existing.installation_id = installations.id
          and existing.subject_type = 'release_run'
          and existing.subject_id = release_runs.id
          and existing.reason_code = 'reporting_stale'
      )
    order by release_run_results.received_at asc, release_runs.id asc
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

create or replace function boardreadyops_claim_github_check_run_reconciliation(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  reconciliation_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  execution_attempt_id text,
  subject_type text,
  subject_id text,
  reason_code text,
  deadline_at timestamptz,
  next_check_at timestamptz,
  attempt_count integer
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpri.id, cpri.attempt_count, cpri.max_attempts
    from control_plane_reconciliation_items cpri
    where cpri.status = 'leased'
      and cpri.subject_type = 'release_run'
      and cpri.reason_code = 'reporting_stale'
      and cpri.lease_expires_at <= p_now
    for update skip locked
  )
  update control_plane_reconciliation_items cpri
  set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
      next_check_at = case when expired.attempt_count >= expired.max_attempts then cpri.next_check_at else p_now end,
      lease_owner = null,
      lease_expires_at = null,
      completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
      public_failure_reason = case
        when expired.attempt_count >= expired.max_attempts then 'github_check_run_reconciliation_failed'
        else null
      end,
      last_error_class = 'lease_expired',
      last_error_message = 'The GitHub Check Run reconciliation lease expired before completion.'
  from expired
  where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
    from control_plane_reconciliation_items cpri
    where cpri.status = 'available'
      and cpri.subject_type = 'release_run'
      and cpri.reason_code = 'reporting_stale'
      and cpri.next_check_at <= p_now
    order by cpri.next_check_at asc, cpri.deadline_at asc, cpri.created_at asc, cpri.id asc
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_reconciliation_items cpri
    set status = 'leased',
        attempt_count = cpri.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = p_lease_expires_at,
        completed_at = null,
        outcome_code = null,
        repaired = false,
        public_failure_reason = null,
        last_error_class = null,
        last_error_message = null
    from candidates
    where cpri.id = candidates.id
    returning cpri.*
  )
  select claimed.id, claimed.installation_id, claimed.repository_id,
         claimed.release_run_id, claimed.execution_attempt_id,
         claimed.subject_type, claimed.subject_id, claimed.reason_code,
         claimed.deadline_at, claimed.next_check_at, claimed.attempt_count
  from claimed
  order by claimed.next_check_at asc, claimed.deadline_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_github_check_run_reconciliation_context(
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
  github_check_run_id bigint,
  run_status text,
  expected_conclusion text,
  completed_at timestamptz,
  deadline_at timestamptz
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
    release_runs.github_check_run_id,
    release_runs.status,
    release_run_results.github_check_conclusion,
    coalesce(release_runs.completed_at, release_run_results.received_at),
    cpri.deadline_at
  from control_plane_reconciliation_items cpri
  join release_runs
    on release_runs.id = cpri.release_run_id
   and release_runs.id = cpri.subject_id
  join release_run_results on release_run_results.run_id = release_runs.id
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
    and release_run_results.github_check_published_at is null;
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
  v_outcome text;
begin
  if p_observed_status !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or (p_observed_conclusion is not null and p_observed_conclusion !~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
     or p_action not in ('observed_current', 'updated') then
    raise exception 'invalid Check Run reconciliation observation' using errcode = '22023';
  end if;

  select cpri as item, rr as run, rrr as result
  into v_locked
  from control_plane_reconciliation_items cpri
  join release_runs rr
    on rr.id = cpri.release_run_id
   and rr.id = cpri.subject_id
  join release_run_results rrr on rrr.run_id = rr.id
  where cpri.id = p_reconciliation_id
    and cpri.status = 'leased'
    and cpri.lease_owner = p_worker_id
    and cpri.subject_type = 'release_run'
    and cpri.reason_code = 'reporting_stale'
    and rr.status in ('completed', 'failed', 'timed_out')
    and rr.github_check_run_id is not null
  -- for update of control_plane_reconciliation_items, release_runs, release_run_results
  for update of cpri, rr, rrr;

  if not found then
    return 'stale';
  end if;

  v_item := v_locked.item;
  v_run := v_locked.run;
  v_result := v_locked.result;

  if v_result.github_check_published_at is not null then
    v_outcome := 'already_published';
  else
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
  end if;

  update control_plane_reconciliation_items
  set status = 'completed',
      lease_owner = null,
      lease_expires_at = null,
      completed_at = p_now,
      outcome_code = case when v_outcome = 'applied' then 'github_check_run_reconciled' else 'already_published' end,
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
      'action', p_action,
      'outcome', v_outcome
    )),
    p_now
  );

  return v_outcome;
end;
$$;

create or replace function boardreadyops_fail_github_check_run_reconciliation(
  p_reconciliation_id text,
  p_worker_id text,
  p_now timestamptz,
  p_observed_status text,
  p_observed_conclusion text,
  p_public_failure_reason text
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
  v_outcome text;
begin
  if p_observed_status !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
     or (p_observed_conclusion is not null and p_observed_conclusion !~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
     or p_public_failure_reason !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'invalid Check Run reconciliation failure' using errcode = '22023';
  end if;

  select cpri as item, rr as run, rrr as result
  into v_locked
  from control_plane_reconciliation_items cpri
  join release_runs rr
    on rr.id = cpri.release_run_id
   and rr.id = cpri.subject_id
  join release_run_results rrr on rrr.run_id = rr.id
  where cpri.id = p_reconciliation_id
    and cpri.status = 'leased'
    and cpri.lease_owner = p_worker_id
    and cpri.subject_type = 'release_run'
    and cpri.reason_code = 'reporting_stale'
  for update of cpri, rr, rrr;

  if not found then
    return 'stale';
  end if;

  v_item := v_locked.item;
  v_run := v_locked.run;
  v_result := v_locked.result;

  if v_result.github_check_published_at is not null then
    v_outcome := 'already_published';
  else
    update release_run_results
    set last_publication_attempt_at = p_now,
        last_publication_error = left(p_public_failure_reason, 4000)
    where run_id = v_run.id
      and github_check_published_at is null;

    if not found then
      raise exception 'Check Run failure state changed while leased' using errcode = '40001';
    end if;
    v_outcome := 'failed';
  end if;

  update control_plane_reconciliation_items
  set status = 'completed',
      lease_owner = null,
      lease_expires_at = null,
      completed_at = p_now,
      outcome_code = case when v_outcome = 'failed' then p_public_failure_reason else 'already_published' end,
      repaired = false,
      public_failure_reason = case when v_outcome = 'failed' then p_public_failure_reason else null end,
      last_error_class = case when v_outcome = 'failed' then 'github_check_run_reconciliation_failed' else null end,
      last_error_message = case when v_outcome = 'failed' then 'GitHub Check Run publication did not converge before its deadline.' else null end
  where id = v_item.id
    and status = 'leased'
    and lease_owner = p_worker_id;

  if not found then
    raise exception 'Check Run reconciliation lease changed while recording failure' using errcode = '40001';
  end if;

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    metadata, created_at
  ) values (
    gen_random_uuid()::text,
    v_item.installation_id,
    'control_plane.github_check_run_reconciliation_failed',
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
      'publicFailureReason', case when v_outcome = 'failed' then p_public_failure_reason else null end,
      'outcome', v_outcome
    )),
    p_now
  );

  return v_outcome;
end;
$$;
