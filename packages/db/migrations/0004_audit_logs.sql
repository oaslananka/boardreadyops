-- Tenant-scoped audit logs.
-- Events are immutable after insertion and every optional resource dimension
-- is validated against the same installation boundary.

create table if not exists audit_events (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id text,
  actor_login text,
  subject_type text not null,
  subject_id text,
  repository_id text references repositories(id) on delete set null,
  release_run_id text references release_runs(id) on delete set null,
  artifact_id text references artifacts(id) on delete set null,
  runner_registration_id text references runner_registrations(id) on delete set null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint audit_events_event_type_valid
    check (
      event_type = btrim(event_type)
      and char_length(event_type) between 3 and 160
      and event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  constraint audit_events_actor_type_valid
    check (
      actor_type = btrim(actor_type)
      and char_length(actor_type) between 1 and 64
      and actor_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  constraint audit_events_actor_id_valid
    check (actor_id is null or (actor_id = btrim(actor_id) and char_length(actor_id) between 1 and 256)),
  constraint audit_events_actor_login_valid
    check (
      actor_login is null
      or (actor_login = btrim(actor_login) and char_length(actor_login) between 1 and 256)
    ),
  constraint audit_events_subject_type_valid
    check (
      subject_type = btrim(subject_type)
      and char_length(subject_type) between 1 and 64
      and subject_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  constraint audit_events_subject_id_valid
    check (subject_id is null or (subject_id = btrim(subject_id) and char_length(subject_id) between 1 and 256)),
  constraint audit_events_request_id_valid
    check (request_id is null or (request_id = btrim(request_id) and char_length(request_id) between 1 and 256)),
  constraint audit_events_metadata_valid
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 65536),
  constraint audit_events_release_run_dimension_valid
    check (release_run_id is null or repository_id is not null),
  constraint audit_events_artifact_dimension_valid
    check (artifact_id is null or release_run_id is not null)
);

create or replace function boardreadyops_validate_audit_event_scope()
returns trigger
language plpgsql
as $$
begin
  if new.repository_id is not null and not exists (
    select 1
    from repositories
    where id = new.repository_id
      and installation_id = new.installation_id
  ) then
    raise exception 'audit repository does not belong to installation'
      using errcode = '23514';
  end if;

  if new.release_run_id is not null and not exists (
    select 1
    from release_runs
    where id = new.release_run_id
      and repository_id = new.repository_id
  ) then
    raise exception 'audit release run does not belong to repository'
      using errcode = '23514';
  end if;

  if new.artifact_id is not null and not exists (
    select 1
    from artifacts
    where id = new.artifact_id
      and run_id = new.release_run_id
  ) then
    raise exception 'audit artifact does not belong to release run'
      using errcode = '23514';
  end if;

  if new.runner_registration_id is not null and not exists (
    select 1
    from runner_registrations
    where id = new.runner_registration_id
      and installation_id = new.installation_id
  ) then
    raise exception 'audit runner does not belong to installation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function boardreadyops_reject_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists audit_events_validate_scope on audit_events;
create trigger audit_events_validate_scope
  before insert on audit_events
  for each row execute function boardreadyops_validate_audit_event_scope();

drop trigger if exists audit_events_append_only on audit_events;
create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function boardreadyops_reject_audit_event_mutation();

create index if not exists audit_events_installation_created_at_idx
  on audit_events(installation_id, created_at desc, id desc);

create index if not exists audit_events_installation_event_type_idx
  on audit_events(installation_id, event_type, created_at desc, id desc);

create index if not exists audit_events_repository_idx
  on audit_events(installation_id, repository_id, created_at desc, id desc)
  where repository_id is not null;

create index if not exists audit_events_release_run_idx
  on audit_events(installation_id, release_run_id, created_at desc, id desc)
  where release_run_id is not null;

create index if not exists audit_events_artifact_idx
  on audit_events(installation_id, artifact_id, created_at desc, id desc)
  where artifact_id is not null;

create index if not exists audit_events_runner_registration_idx
  on audit_events(installation_id, runner_registration_id, created_at desc, id desc)
  where runner_registration_id is not null;

create index if not exists audit_events_request_idx
  on audit_events(installation_id, request_id, created_at desc, id desc)
  where request_id is not null;
