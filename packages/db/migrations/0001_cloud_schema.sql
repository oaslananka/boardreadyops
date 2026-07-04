-- BoardReadyOps Cloud initial schema.
-- Idempotent by design so the self-hosted deploy path can safely re-run it.

create extension if not exists pgcrypto;

create table if not exists cloud_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists installations (
  id text primary key default gen_random_uuid()::text,
  github_installation_id bigint not null unique,
  account_login text not null,
  account_type text not null,
  plan_tier text not null default 'free',
  created_at timestamptz not null default now(),
  suspended_at timestamptz
);

create table if not exists repositories (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  github_repo_id bigint not null unique,
  owner text not null,
  name text not null,
  private boolean not null default false,
  default_branch text not null,
  enabled_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (installation_id, owner, name)
);

create table if not exists release_runs (
  id text primary key default gen_random_uuid()::text,
  repository_id text not null references repositories(id) on delete cascade,
  idempotency_key text unique,
  commit_sha text not null,
  ref text not null,
  pull_request_number integer,
  trigger_kind text not null,
  status text not null default 'queued',
  decision text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  board_ready_ops_version text,
  kicad_version text,
  github_check_run_id bigint,
  readiness_score integer
);

create index if not exists release_runs_repository_started_at_idx on release_runs(repository_id, started_at);
create index if not exists release_runs_commit_sha_idx on release_runs(commit_sha);

create table if not exists findings (
  id text primary key default gen_random_uuid()::text,
  run_id text not null references release_runs(id) on delete cascade,
  rule_id text not null,
  severity text not null,
  message text not null,
  path text,
  kind text,
  waived_at timestamptz
);

create table if not exists artifacts (
  id text primary key default gen_random_uuid()::text,
  run_id text not null references release_runs(id) on delete cascade,
  kind text not null,
  name text not null,
  storage_path text not null,
  sha256 text not null,
  bytes integer not null,
  role text not null,
  uploaded_at timestamptz not null default now()
);
