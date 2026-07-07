-- Tenant-scoped audit logs.
-- Events are append-only at the application level and scoped to installations.

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
  runner_registration_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_installation_created_at_idx
  on audit_events(installation_id, created_at desc);

create index if not exists audit_events_installation_event_type_idx
  on audit_events(installation_id, event_type, created_at desc);

create index if not exists audit_events_repository_idx
  on audit_events(repository_id, created_at desc)
  where repository_id is not null;

create index if not exists audit_events_release_run_idx
  on audit_events(release_run_id, created_at desc)
  where release_run_id is not null;
