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
  unique (installation_id, name),
  constraint runner_registrations_name_valid
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint runner_registrations_scope_valid
    check (scope in ('installation', 'organization', 'repository')),
  constraint runner_registrations_allowed_repositories_valid
    check (cardinality(allowed_repositories) <= 256 and array_position(allowed_repositories, null) is null),
  constraint runner_registrations_fingerprint_valid
    check (
      public_key_fingerprint is null
      or (
        public_key_fingerprint = btrim(public_key_fingerprint)
        and char_length(public_key_fingerprint) between 16 and 256
      )
    ),
  constraint runner_registrations_status_valid
    check (status in ('pending', 'active', 'stale', 'disabled')),
  constraint runner_registrations_active_identity_valid
    check (
      status <> 'active'
      or (
        public_key_fingerprint is not null
        and activated_at is not null
        and last_heartbeat_at is not null
      )
    ),
  constraint runner_registrations_disabled_state_valid
    check ((status = 'disabled') = (disabled_at is not null)),
  constraint runner_registrations_timestamps_valid
    check (
      (activated_at is null or activated_at >= created_at)
      and (last_heartbeat_at is null or last_heartbeat_at >= created_at)
      and (disabled_at is null or disabled_at >= created_at)
    )
);

create unique index if not exists runner_registrations_installation_fingerprint_idx
  on runner_registrations(installation_id, public_key_fingerprint)
  where public_key_fingerprint is not null;

create index if not exists runner_registrations_active_heartbeat_idx
  on runner_registrations(installation_id, last_heartbeat_at desc)
  where status = 'active' and disabled_at is null;
