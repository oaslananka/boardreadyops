-- Optimistic-concurrency versions and append-only transition history for
-- logical release runs and their current execution attempts.

alter table release_runs
  add column if not exists version bigint not null default 0;

alter table release_run_attempts
  add column if not exists version bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'release_runs_version_valid'
  ) then
    alter table release_runs
      add constraint release_runs_version_valid check (version >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'release_run_attempts_version_valid'
  ) then
    alter table release_run_attempts
      add constraint release_run_attempts_version_valid check (version >= 0);
  end if;
end;
$$;

create table if not exists release_run_transition_events (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  release_run_id text not null references release_runs(id) on delete cascade,
  execution_attempt_id text references release_run_attempts(id) on delete cascade,
  entity_type text not null,
  from_status text not null,
  to_status text not null,
  from_version bigint not null,
  to_version bigint not null,
  reason_code text not null,
  occurred_at timestamptz not null default now(),
  constraint release_run_transition_events_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint release_run_transition_events_entity_type_valid
    check (entity_type in ('release_run', 'execution_attempt')),
  constraint release_run_transition_events_entity_dimension_valid
    check (
      (entity_type = 'release_run' and execution_attempt_id is null)
      or (entity_type = 'execution_attempt' and execution_attempt_id is not null)
    ),
  constraint release_run_transition_events_status_valid
    check (
      from_status = btrim(from_status)
      and to_status = btrim(to_status)
      and char_length(from_status) between 1 and 64
      and char_length(to_status) between 1 and 64
      and from_status ~ '^[a-z0-9]+([_-][a-z0-9]+)*$'
      and to_status ~ '^[a-z0-9]+([_-][a-z0-9]+)*$'
    ),
  constraint release_run_transition_events_version_valid
    check (from_version >= 0 and to_version = from_version + 1),
  constraint release_run_transition_events_reason_code_valid
    check (
      reason_code = btrim(reason_code)
      and char_length(reason_code) between 1 and 128
      and reason_code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
);

create or replace function boardreadyops_validate_release_run_transition_event_scope()
returns trigger
language plpgsql
as $$
declare
  v_installation_id text;
  v_repository_id text;
begin
  select repositories.installation_id, release_runs.repository_id
    into v_installation_id, v_repository_id
    from release_runs
    join repositories on repositories.id = release_runs.repository_id
   where release_runs.id = new.release_run_id;

  if v_installation_id is null then
    raise exception 'transition release run was not found'
      using errcode = '23503';
  end if;

  if new.installation_id is distinct from v_installation_id
    or new.repository_id is distinct from v_repository_id
  then
    raise exception 'transition event scope does not match release run'
      using errcode = '23514';
  end if;

  if new.entity_type = 'execution_attempt' and not exists (
    select 1
      from release_run_attempts
     where release_run_attempts.id = new.execution_attempt_id
       and release_run_attempts.run_id = new.release_run_id
  ) then
    raise exception 'transition attempt does not belong to release run'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function boardreadyops_reject_release_run_transition_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception 'release_run_transition_events is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists release_run_transition_events_validate_scope on release_run_transition_events;
create trigger release_run_transition_events_validate_scope
  before insert on release_run_transition_events
  for each row execute function boardreadyops_validate_release_run_transition_event_scope();

drop trigger if exists release_run_transition_events_append_only on release_run_transition_events;
create trigger release_run_transition_events_append_only
  before update or delete on release_run_transition_events
  for each row execute function boardreadyops_reject_release_run_transition_event_mutation();

create index if not exists release_run_transition_events_run_idx
  on release_run_transition_events(installation_id, repository_id, release_run_id, occurred_at, id);

create index if not exists release_run_transition_events_attempt_idx
  on release_run_transition_events(installation_id, execution_attempt_id, occurred_at, id)
  where execution_attempt_id is not null;

create or replace function boardreadyops_release_run_transition_allowed(
  p_from_status text,
  p_to_status text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select case
    when p_from_status = 'queued' and p_to_status in (
      'dispatched', 'running', 'completed', 'failed', 'timed_out', 'cancelled', 'superseded'
    ) then true
    when p_from_status = 'dispatched' and p_to_status in (
      'running', 'completed', 'failed', 'timed_out', 'cancelled', 'superseded'
    ) then true
    when p_from_status = 'running' and p_to_status in (
      'completed', 'failed', 'timed_out', 'cancelled', 'superseded'
    ) then true
    else false
  end;
$$;

create or replace function boardreadyops_release_run_attempt_transition_allowed(
  p_from_status text,
  p_to_status text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select case
    when p_from_status = 'queued' and p_to_status in (
      'dispatching', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    when p_from_status = 'dispatching' and p_to_status in (
      'dispatched', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    when p_from_status = 'dispatched' and p_to_status in (
      'in_progress', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    when p_from_status = 'in_progress' and p_to_status in (
      'uploading_artifacts', 'reporting', 'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    when p_from_status = 'uploading_artifacts' and p_to_status in (
      'reporting', 'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    when p_from_status = 'reporting' and p_to_status in (
      'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded'
    ) then true
    else false
  end;
$$;

create or replace function boardreadyops_transition_release_run_state(
  p_release_run_id text,
  p_expected_run_status text,
  p_expected_run_version bigint,
  p_expected_execution_attempt_id text,
  p_next_run_status text,
  p_reason_code text,
  p_now timestamptz,
  p_expected_attempt_status text default null,
  p_expected_attempt_version bigint default null,
  p_next_attempt_status text default null
)
returns table(
  transition_outcome text,
  run_status text,
  run_version bigint,
  attempt_status text,
  attempt_version bigint
)
language plpgsql
security invoker
as $$
declare
  v_run release_runs%rowtype;
  v_attempt release_run_attempts%rowtype;
  v_installation_id text;
  v_repository_id text;
  v_run_from_status text;
  v_run_from_version bigint;
  v_run_to_version bigint;
  v_attempt_from_status text;
  v_attempt_from_version bigint;
  v_attempt_to_version bigint;
begin
  select release_runs.*
    into v_run
    from release_runs
   where release_runs.id = p_release_run_id
   for update of release_runs;

  if v_run.id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, null::text, null::bigint;
    return;
  end if;

  select repositories.installation_id, repositories.id
    into v_installation_id, v_repository_id
    from repositories
   where repositories.id = v_run.repository_id;

  if v_installation_id is null then
    return query
    select 'not_found'::text, null::text, null::bigint, null::text, null::bigint;
    return;
  end if;

  if v_run.status is distinct from p_expected_run_status
    or v_run.version is distinct from p_expected_run_version
    or v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id
  then
    return query
    select 'stale'::text, v_run.status, v_run.version, null::text, null::bigint;
    return;
  end if;

  if p_expected_run_version < 0
    or p_reason_code is null
    or p_reason_code is distinct from btrim(p_reason_code)
    or char_length(p_reason_code) not between 1 and 128
    or p_reason_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  then
    return query
    select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint;
    return;
  end if;

  if p_expected_execution_attempt_id is not null then
    select release_run_attempts.*
      into v_attempt
      from release_run_attempts
     where release_run_attempts.id = p_expected_execution_attempt_id
       and release_run_attempts.run_id = p_release_run_id
     for update of release_run_attempts;

    if v_attempt.id is null then
      return query
      select 'not_found'::text, v_run.status, v_run.version, null::text, null::bigint;
      return;
    end if;

    if p_expected_attempt_status is not null
      and v_attempt.status is distinct from p_expected_attempt_status
    then
      return query
      select 'stale'::text, v_run.status, v_run.version, v_attempt.status, v_attempt.version;
      return;
    end if;

    if p_expected_attempt_version is not null
      and v_attempt.version is distinct from p_expected_attempt_version
    then
      return query
      select 'stale'::text, v_run.status, v_run.version, v_attempt.status, v_attempt.version;
      return;
    end if;
  elsif p_expected_attempt_status is not null
    or p_expected_attempt_version is not null
    or p_next_attempt_status is not null
  then
    return query
    select 'invalid_transition'::text, v_run.status, v_run.version, null::text, null::bigint;
    return;
  end if;

  if not boardreadyops_release_run_transition_allowed(
    v_run.status,
    p_next_run_status
  ) then
    return query
    select 'invalid_transition'::text,
           v_run.status,
           v_run.version,
           v_attempt.status,
           v_attempt.version;
    return;
  end if;

  if p_next_attempt_status is not null and (
    p_expected_attempt_status is null
    or p_expected_attempt_version is null
    or p_expected_attempt_version < 0
  ) then
    return query
    select 'invalid_transition'::text,
           v_run.status,
           v_run.version,
           v_attempt.status,
           v_attempt.version;
    return;
  end if;

  if p_next_attempt_status is not null and not boardreadyops_release_run_attempt_transition_allowed(
    v_attempt.status,
    p_next_attempt_status
  ) then
    return query
    select 'invalid_transition'::text,
           v_run.status,
           v_run.version,
           v_attempt.status,
           v_attempt.version;
    return;
  end if;

  v_run_from_status := v_run.status;
  v_run_from_version := v_run.version;
  v_attempt_from_status := v_attempt.status;
  v_attempt_from_version := v_attempt.version;

  if p_next_attempt_status is not null then
    update release_run_attempts
       set status = p_next_attempt_status,
           version = release_run_attempts.version + 1,
           completed_at = case
             when p_next_attempt_status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')
               then coalesce(release_run_attempts.completed_at, p_now)
             else release_run_attempts.completed_at
           end
     where release_run_attempts.id = p_expected_execution_attempt_id
       and release_run_attempts.run_id = p_release_run_id
       and release_run_attempts.status = p_expected_attempt_status
       and release_run_attempts.version = p_expected_attempt_version
    returning release_run_attempts.version into v_attempt_to_version;

    if v_attempt_to_version is null then
      raise exception 'attempt transition changed after it was locked'
        using errcode = '40001';
    end if;
  end if;

  update release_runs
     set status = p_next_run_status,
         version = release_runs.version + 1,
         completed_at = case
           when p_next_run_status in ('completed', 'failed', 'timed_out', 'cancelled', 'superseded')
             then coalesce(release_runs.completed_at, p_now)
           else release_runs.completed_at
         end,
         duration_ms = case
           when p_next_run_status in ('completed', 'failed', 'timed_out', 'cancelled', 'superseded')
             and release_runs.duration_ms is null
             then greatest(0, floor(extract(epoch from (p_now - release_runs.started_at)) * 1000))::integer
           else release_runs.duration_ms
         end
   where release_runs.id = p_release_run_id
     and release_runs.status = p_expected_run_status
     and release_runs.version = p_expected_run_version
     and release_runs.execution_attempt_id is not distinct from p_expected_execution_attempt_id
  returning release_runs.version into v_run_to_version;

  if v_run_to_version is null then
    raise exception 'release-run transition changed after it was locked'
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
    v_run_from_status,
    p_next_run_status,
    v_run_from_version,
    v_run_to_version,
    p_reason_code,
    p_now
  );

  if p_next_attempt_status is not null then
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
      p_expected_execution_attempt_id,
      'execution_attempt',
      v_attempt_from_status,
      p_next_attempt_status,
      v_attempt_from_version,
      v_attempt_to_version,
      p_reason_code,
      p_now
    );
  end if;

  return query
  select 'applied'::text,
         p_next_run_status,
         v_run_to_version,
         coalesce(p_next_attempt_status, v_attempt.status),
         coalesce(v_attempt_to_version, v_attempt.version);
end;
$$;
