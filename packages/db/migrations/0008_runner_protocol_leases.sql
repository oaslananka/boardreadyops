-- Shared managed/self-hosted runner protocol persistence.
-- Lease secrets and request nonces are stored only as SHA-256 digests.

alter table runner_registrations
  add column if not exists signing_algorithm text not null default 'ed25519';

alter table runner_registrations
  add column if not exists public_key text;

alter table runner_registrations
  add column if not exists capabilities jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runner_registrations_signing_algorithm_valid'
  ) then
    alter table runner_registrations
      add constraint runner_registrations_signing_algorithm_valid
      check (signing_algorithm = 'ed25519');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'runner_registrations_public_key_valid'
  ) then
    alter table runner_registrations
      add constraint runner_registrations_public_key_valid
      check (public_key is null or char_length(public_key) between 32 and 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'runner_registrations_capabilities_valid'
  ) then
    alter table runner_registrations
      add constraint runner_registrations_capabilities_valid
      check (jsonb_typeof(capabilities) = 'array' and pg_column_size(capabilities) <= 32768);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'runner_registrations_active_verification_key_valid'
  ) then
    alter table runner_registrations
      add constraint runner_registrations_active_verification_key_valid
      check (status <> 'active' or public_key is not null) not valid;
  end if;
end
$$;

create table if not exists managed_runner_identities (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  signing_algorithm text not null default 'ed25519',
  public_key text not null,
  public_key_fingerprint text not null unique,
  capabilities jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_heartbeat_at timestamptz,
  disabled_at timestamptz,
  constraint managed_runner_identities_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint managed_runner_identities_name_valid
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint managed_runner_identities_signing_algorithm_valid
    check (signing_algorithm = 'ed25519'),
  constraint managed_runner_identities_public_key_valid
    check (char_length(public_key) between 32 and 16384),
  constraint managed_runner_identities_fingerprint_valid
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint managed_runner_identities_capabilities_valid
    check (jsonb_typeof(capabilities) = 'array' and pg_column_size(capabilities) <= 32768),
  constraint managed_runner_identities_status_valid
    check (status in ('pending', 'active', 'stale', 'disabled')),
  constraint managed_runner_identities_active_state_valid
    check (
      status <> 'active'
      or (activated_at is not null and last_heartbeat_at is not null and disabled_at is null)
    ),
  constraint managed_runner_identities_disabled_state_valid
    check ((status = 'disabled') = (disabled_at is not null)),
  constraint managed_runner_identities_timestamps_valid
    check (
      (activated_at is null or activated_at >= created_at)
      and (last_heartbeat_at is null or last_heartbeat_at >= created_at)
      and (disabled_at is null or disabled_at >= created_at)
    )
);

create index if not exists managed_runner_identities_active_heartbeat_idx
  on managed_runner_identities(last_heartbeat_at desc, id)
  where status = 'active' and disabled_at is null;

create unique index if not exists release_run_attempts_id_run_idx
  on release_run_attempts(id, run_id);

create table if not exists runner_job_leases (
  id text primary key default gen_random_uuid()::text,
  run_id text not null references release_runs(id) on delete cascade,
  execution_attempt_id text not null,
  worker_class text not null,
  runner_registration_id text references runner_registrations(id) on delete restrict,
  managed_runner_identity_id text references managed_runner_identities(id) on delete restrict,
  lease_token_digest text not null,
  status text not null default 'active',
  stage text not null default 'claimed',
  progress_percent integer,
  last_message text,
  claimed_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  maximum_expires_at timestamptz not null,
  closed_at timestamptz,
  close_reason text,
  constraint runner_job_leases_attempt_fk
    foreign key (execution_attempt_id, run_id)
    references release_run_attempts(id, run_id)
    on delete cascade,
  constraint runner_job_leases_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint runner_job_leases_worker_class_valid
    check (worker_class in ('managed', 'self_hosted')),
  constraint runner_job_leases_worker_identity_valid
    check (
      (
        worker_class = 'self_hosted'
        and runner_registration_id is not null
        and managed_runner_identity_id is null
      )
      or (
        worker_class = 'managed'
        and runner_registration_id is null
        and managed_runner_identity_id is not null
      )
    ),
  constraint runner_job_leases_token_digest_valid
    check (lease_token_digest ~ '^[0-9a-f]{64}$'),
  constraint runner_job_leases_status_valid
    check (status in ('active', 'completed', 'relinquished', 'expired', 'revoked', 'stale')),
  constraint runner_job_leases_stage_valid
    check (stage in ('claimed', 'preparing_source', 'running', 'uploading_artifacts', 'reporting')),
  constraint runner_job_leases_progress_valid
    check (progress_percent is null or progress_percent between 0 and 100),
  constraint runner_job_leases_message_valid
    check (last_message is null or char_length(last_message) <= 1000),
  constraint runner_job_leases_expiry_valid
    check (
      heartbeat_at >= claimed_at
      and expires_at > claimed_at
      and maximum_expires_at >= expires_at
      and (closed_at is null or closed_at >= claimed_at)
    ),
  constraint runner_job_leases_closed_state_valid
    check ((status = 'active') = (closed_at is null)),
  constraint runner_job_leases_close_reason_valid
    check (close_reason is null or (close_reason = btrim(close_reason) and char_length(close_reason) between 1 and 1000))
);

create unique index if not exists runner_job_leases_one_active_attempt_idx
  on runner_job_leases(execution_attempt_id)
  where status = 'active';

create index if not exists runner_job_leases_active_expiry_idx
  on runner_job_leases(expires_at, execution_attempt_id)
  where status = 'active';

create index if not exists runner_job_leases_self_hosted_runner_idx
  on runner_job_leases(runner_registration_id, claimed_at desc, id desc)
  where runner_registration_id is not null;

create index if not exists runner_job_leases_managed_runner_idx
  on runner_job_leases(managed_runner_identity_id, claimed_at desc, id desc)
  where managed_runner_identity_id is not null;

create or replace function boardreadyops_validate_runner_job_lease_scope()
returns trigger
language plpgsql
as $$
declare
  scope_changed boolean;
begin
  if tg_op = 'INSERT' then
    scope_changed := true;
  else
    scope_changed := new.run_id is distinct from old.run_id
      or new.execution_attempt_id is distinct from old.execution_attempt_id
      or new.worker_class is distinct from old.worker_class
      or new.runner_registration_id is distinct from old.runner_registration_id
      or new.managed_runner_identity_id is distinct from old.managed_runner_identity_id;
  end if;

  if scope_changed then
    if not exists (
      select 1
      from release_runs
      where id = new.run_id
        and execution_attempt_id = new.execution_attempt_id
    ) then
      raise exception 'runner lease must target the current release-run attempt'
        using errcode = '23514';
    end if;

    if new.worker_class = 'self_hosted' and not exists (
      select 1
      from release_runs
      join repositories on repositories.id = release_runs.repository_id
      join runner_registrations on runner_registrations.id = new.runner_registration_id
      where release_runs.id = new.run_id
        and runner_registrations.installation_id = repositories.installation_id
        and runner_registrations.status = 'active'
        and runner_registrations.disabled_at is null
    ) then
      raise exception 'self-hosted runner does not belong to the release-run installation'
        using errcode = '23514';
    end if;

    if new.worker_class = 'managed' and not exists (
      select 1
      from managed_runner_identities
      where id = new.managed_runner_identity_id
        and status = 'active'
        and disabled_at is null
    ) then
      raise exception 'managed runner identity is not active'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists runner_job_leases_validate_scope on runner_job_leases;
create trigger runner_job_leases_validate_scope
  before insert or update on runner_job_leases
  for each row execute function boardreadyops_validate_runner_job_lease_scope();

create table if not exists runner_request_nonces (
  id text primary key default gen_random_uuid()::text,
  worker_class text not null,
  runner_registration_id text references runner_registrations(id) on delete cascade,
  managed_runner_identity_id text references managed_runner_identities(id) on delete cascade,
  runner_job_lease_id text references runner_job_leases(id) on delete cascade,
  nonce_digest text not null,
  request_timestamp timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint runner_request_nonces_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint runner_request_nonces_worker_class_valid
    check (worker_class in ('managed', 'self_hosted')),
  constraint runner_request_nonces_worker_identity_valid
    check (
      (
        worker_class = 'self_hosted'
        and runner_registration_id is not null
        and managed_runner_identity_id is null
      )
      or (
        worker_class = 'managed'
        and runner_registration_id is null
        and managed_runner_identity_id is not null
      )
    ),
  constraint runner_request_nonces_digest_valid
    check (nonce_digest ~ '^[0-9a-f]{64}$'),
  constraint runner_request_nonces_expiry_valid
    check (expires_at > request_timestamp and expires_at >= created_at)
);

create unique index if not exists runner_request_nonces_self_hosted_unique_idx
  on runner_request_nonces(runner_registration_id, nonce_digest)
  where runner_registration_id is not null;

create unique index if not exists runner_request_nonces_managed_unique_idx
  on runner_request_nonces(managed_runner_identity_id, nonce_digest)
  where managed_runner_identity_id is not null;

create index if not exists runner_request_nonces_expiry_idx
  on runner_request_nonces(expires_at, id);

create index if not exists runner_request_nonces_lease_idx
  on runner_request_nonces(runner_job_lease_id, created_at desc, id desc)
  where runner_job_lease_id is not null;

create or replace function boardreadyops_validate_runner_request_nonce_scope()
returns trigger
language plpgsql
as $$
begin
  if new.runner_job_lease_id is not null and not exists (
    select 1
    from runner_job_leases
    where id = new.runner_job_lease_id
      and worker_class = new.worker_class
      and (
        (
          new.worker_class = 'self_hosted'
          and runner_registration_id = new.runner_registration_id
        )
        or (
          new.worker_class = 'managed'
          and managed_runner_identity_id = new.managed_runner_identity_id
        )
      )
  ) then
    raise exception 'runner request nonce does not match the lease worker identity'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists runner_request_nonces_validate_scope on runner_request_nonces;
create trigger runner_request_nonces_validate_scope
  before insert or update on runner_request_nonces
  for each row execute function boardreadyops_validate_runner_request_nonce_scope();
