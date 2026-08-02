-- Aggregate self-hosted runner fleet visibility and last-reported agent versions.
-- The existing 13-argument claim function remains available for application rollback.

alter table public.runner_registrations
  add column if not exists last_runner_version text;

alter table public.runner_registrations
  drop constraint if exists runner_registrations_last_runner_version_valid;

alter table public.runner_registrations
  add constraint runner_registrations_last_runner_version_valid
  check (
    last_runner_version is null
    or case
      when char_length(last_runner_version) <= 64
       and last_runner_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
      then split_part(last_runner_version, '.', 1)::numeric <= 9007199254740991
       and split_part(last_runner_version, '.', 2)::numeric <= 9007199254740991
       and split_part(last_runner_version, '.', 3)::numeric <= 9007199254740991
      else false
    end
  );

create index if not exists runner_registrations_active_version_idx
  on public.runner_registrations(installation_id, last_runner_version)
  where status = 'active' and disabled_at is null;

create or replace function public.boardreadyops_claim_runner_job(
  p_now timestamptz,
  p_worker_class text,
  p_runner_registration_id text,
  p_managed_runner_identity_id text,
  p_capabilities jsonb,
  p_nonce_digest text,
  p_request_timestamp timestamptz,
  p_nonce_expires_at timestamptz,
  p_attempt_id text,
  p_lease_id text,
  p_lease_token_digest text,
  p_lease_expires_at timestamptz,
  p_maximum_lease_expires_at timestamptz,
  p_runner_version text
)
returns table (
  outcome text,
  lease_id text,
  run_id text,
  execution_attempt_id text,
  expires_at timestamptz,
  maximum_expires_at timestamptz,
  repository_owner text,
  repository_name text,
  commit_sha text,
  repository_private boolean,
  trust_mode text,
  safe_mode_reasons text[]
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  request_was_accepted boolean := false;
  base_result record;
begin
  if p_runner_version is not null then
    if char_length(p_runner_version) > 64
       or p_runner_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' then
      raise exception 'runner version is invalid' using errcode = '22023';
    end if;
    if split_part(p_runner_version, '.', 1)::numeric > 9007199254740991
       or split_part(p_runner_version, '.', 2)::numeric > 9007199254740991
       or split_part(p_runner_version, '.', 3)::numeric > 9007199254740991 then
      raise exception 'runner version is invalid' using errcode = '22023';
    end if;
  end if;

  select *
    into strict base_result
    from public.boardreadyops_claim_runner_job(
      p_now,
      p_worker_class,
      p_runner_registration_id,
      p_managed_runner_identity_id,
      p_capabilities,
      p_nonce_digest,
      p_request_timestamp,
      p_nonce_expires_at,
      p_attempt_id,
      p_lease_id,
      p_lease_token_digest,
      p_lease_expires_at,
      p_maximum_lease_expires_at
    );

  if base_result.outcome in ('claimed', 'empty') then
    select exists (
      select 1
        from public.runner_request_nonces
       where runner_request_nonces.worker_class = p_worker_class
         and runner_request_nonces.nonce_digest = p_nonce_digest
         and (
           (
             p_worker_class = 'self_hosted'
             and runner_request_nonces.runner_registration_id = p_runner_registration_id
             and runner_request_nonces.managed_runner_identity_id is null
           )
           or (
             p_worker_class = 'managed'
             and runner_request_nonces.managed_runner_identity_id = p_managed_runner_identity_id
             and runner_request_nonces.runner_registration_id is null
           )
         )
    ) into request_was_accepted;
  end if;

  if request_was_accepted then
    if p_worker_class = 'self_hosted' then
      update public.runner_registrations
         set last_heartbeat_at = p_now,
             last_runner_version = coalesce(p_runner_version, runner_registrations.last_runner_version)
       where runner_registrations.id = p_runner_registration_id
         and runner_registrations.status = 'active'
         and runner_registrations.disabled_at is null;
    elsif p_worker_class = 'managed' then
      update public.managed_runner_identities
         set last_heartbeat_at = p_now
       where managed_runner_identities.id = p_managed_runner_identity_id
         and managed_runner_identities.status = 'active'
         and managed_runner_identities.disabled_at is null;
    end if;
  end if;

  outcome := base_result.outcome;
  lease_id := base_result.lease_id;
  run_id := base_result.run_id;
  execution_attempt_id := base_result.execution_attempt_id;
  expires_at := base_result.expires_at;
  maximum_expires_at := base_result.maximum_expires_at;
  repository_owner := base_result.repository_owner;
  repository_name := base_result.repository_name;
  commit_sha := base_result.commit_sha;
  repository_private := base_result.repository_private;
  trust_mode := base_result.trust_mode;
  safe_mode_reasons := base_result.safe_mode_reasons;
  return next;
end;
$$;
