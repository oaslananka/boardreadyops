-- Signed terminal-result authorization for managed and self-hosted runners.
-- Request digests distinguish safe exact retries from nonce reuse with a different body.

alter table runner_request_nonces
  add column if not exists request_digest text;

alter table runner_request_nonces
  drop constraint if exists runner_request_nonces_request_digest_valid;
alter table runner_request_nonces
  add constraint runner_request_nonces_request_digest_valid
  check (request_digest is null or request_digest ~ '^[0-9a-f]{64}$');

create or replace function boardreadyops_authorize_runner_terminal_result(
  p_now timestamptz,
  p_worker_class text,
  p_run_id text,
  p_execution_attempt_id text,
  p_lease_id text,
  p_runner_registration_id text,
  p_managed_runner_identity_id text,
  p_lease_token_digest text,
  p_nonce_digest text,
  p_request_digest text,
  p_request_timestamp timestamptz,
  p_nonce_expires_at timestamptz
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  lease_status text;
  lease_expires_at timestamptz;
  run_status text;
  nonce_id text;
  persisted_request_digest text;
begin
  select runner_job_leases.status,
         runner_job_leases.expires_at,
         release_runs.status
  into lease_status, lease_expires_at, run_status
  from public.runner_job_leases
  join public.release_runs on release_runs.id = runner_job_leases.run_id
  where runner_job_leases.id = p_lease_id
    and runner_job_leases.run_id = p_run_id
    and runner_job_leases.execution_attempt_id = p_execution_attempt_id
    and runner_job_leases.worker_class = p_worker_class
    and runner_job_leases.runner_registration_id is not distinct from p_runner_registration_id
    and runner_job_leases.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
    and runner_job_leases.lease_token_digest = p_lease_token_digest
    and release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id
  for update of runner_job_leases, release_runs;

  if not found then
    return 'stale';
  end if;

  if not (
    (lease_status = 'active' and lease_expires_at > p_now)
    or (
      lease_status = 'completed'
      and run_status in ('completed', 'failed', 'timed_out')
    )
  ) then
    return 'stale';
  end if;

  insert into public.runner_request_nonces (
    worker_class,
    runner_registration_id,
    managed_runner_identity_id,
    runner_job_lease_id,
    nonce_digest,
    request_digest,
    request_timestamp,
    expires_at
  ) values (
    p_worker_class,
    p_runner_registration_id,
    p_managed_runner_identity_id,
    p_lease_id,
    p_nonce_digest,
    p_request_digest,
    p_request_timestamp,
    p_nonce_expires_at
  )
  on conflict do nothing
  returning id into nonce_id;

  if nonce_id is not null then
    return 'accepted';
  end if;

  select runner_request_nonces.request_digest
  into persisted_request_digest
  from public.runner_request_nonces
  where runner_request_nonces.worker_class = p_worker_class
    and runner_request_nonces.nonce_digest = p_nonce_digest
    and runner_request_nonces.runner_registration_id is not distinct from p_runner_registration_id
    and runner_request_nonces.managed_runner_identity_id is not distinct from p_managed_runner_identity_id
  order by runner_request_nonces.created_at desc, runner_request_nonces.id desc
  limit 1;

  if persisted_request_digest = p_request_digest then
    return 'replayed';
  end if;

  return 'conflicting_replay';
end;
$$;
