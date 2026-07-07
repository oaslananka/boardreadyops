-- Self-hosted runner registration schema.
-- Registration records are tenant-scoped through installations.

create table if not exists runner_registrations (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  name text not null,
  scope text not null default 'installation',
  allowed_repositories text[] not null default '{}',
  public_key_fingerprint text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_heartbeat_at timestamptz,
  disabled_at timestamptz,
  unique (installation_id, name)
);

create index if not exists runner_registrations_installation_status_idx
  on runner_registrations(installation_id, status, last_heartbeat_at);
