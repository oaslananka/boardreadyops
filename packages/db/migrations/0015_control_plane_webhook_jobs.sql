create table if not exists webhook_inbox (
  id text primary key,
  provider text not null,
  delivery_id text not null,
  event_type text not null,
  event_action text,
  installation_external_id bigint,
  repository_external_id bigint,
  repository_full_name text,
  payload_version integer not null default 1,
  payload_sha256 text not null,
  normalized_actions jsonb not null,
  state text not null default 'accepted',
  duplicate_count integer not null default 0,
  duplicate_payload_mismatch_count integer not null default 0,
  received_at timestamptz not null,
  last_received_at timestamptz not null,
  processing_started_at timestamptz,
  processed_at timestamptz,
  retention_until timestamptz not null,
  last_error_class text,
  last_error_message text,
  constraint webhook_inbox_provider_valid check (provider in ('github')),
  constraint webhook_inbox_delivery_id_valid check (char_length(delivery_id) between 1 and 128),
  constraint webhook_inbox_event_type_valid check (char_length(event_type) between 1 and 100),
  constraint webhook_inbox_event_action_valid check (event_action is null or char_length(event_action) between 1 and 100),
  constraint webhook_inbox_repository_name_valid check (
    repository_full_name is null or char_length(repository_full_name) between 3 and 200
  ),
  constraint webhook_inbox_payload_version_valid check (payload_version = 1),
  constraint webhook_inbox_payload_sha256_valid check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint webhook_inbox_actions_valid check (
    jsonb_typeof(normalized_actions) = 'array' and pg_column_size(normalized_actions) <= 262144
  ),
  constraint webhook_inbox_state_valid check (state in ('accepted', 'processing', 'processed', 'failed', 'dead_letter')),
  constraint webhook_inbox_duplicate_count_valid check (
    duplicate_count >= 0 and duplicate_payload_mismatch_count >= 0
  ),
  constraint webhook_inbox_processing_state_valid check (
    (state = 'accepted' and processing_started_at is null and processed_at is null)
    or (state = 'processing' and processing_started_at is not null and processed_at is null)
    or (state in ('processed', 'failed', 'dead_letter') and processed_at is not null)
  ),
  unique (provider, delivery_id)
);

create index if not exists webhook_inbox_state_received_idx
  on webhook_inbox(state, received_at, id);

create index if not exists webhook_inbox_retention_idx
  on webhook_inbox(retention_until, id);

create table if not exists control_plane_jobs (
  id text primary key,
  inbox_id text not null references webhook_inbox(id) on delete cascade,
  job_type text not null,
  payload_version integer not null default 1,
  idempotency_key text not null,
  priority smallint not null default 100,
  status text not null default 'available',
  available_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_class text,
  last_error_message text,
  constraint control_plane_jobs_type_valid check (job_type = 'github_webhook.lifecycle'),
  constraint control_plane_jobs_payload_version_valid check (payload_version = 1),
  constraint control_plane_jobs_idempotency_key_valid check (char_length(idempotency_key) between 1 and 256),
  constraint control_plane_jobs_priority_valid check (priority between 0 and 1000),
  constraint control_plane_jobs_status_valid check (status in ('available', 'leased', 'completed', 'dead_letter')),
  constraint control_plane_jobs_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint control_plane_jobs_lease_valid check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint control_plane_jobs_completion_valid check (
    (status in ('completed', 'dead_letter') and completed_at is not null)
    or (status not in ('completed', 'dead_letter') and completed_at is null)
  ),
  unique (inbox_id),
  unique (job_type, idempotency_key)
);

create index if not exists control_plane_jobs_claim_idx
  on control_plane_jobs(priority, available_at, created_at, id)
  where status = 'available';

create index if not exists control_plane_jobs_lease_expiry_idx
  on control_plane_jobs(lease_expires_at, id)
  where status = 'leased';

create index if not exists control_plane_jobs_dead_letter_idx
  on control_plane_jobs(completed_at desc, id desc)
  where status = 'dead_letter';

create or replace function boardreadyops_accept_github_webhook(
  p_inbox_id text,
  p_job_id text,
  p_provider text,
  p_delivery_id text,
  p_event_type text,
  p_event_action text,
  p_installation_external_id bigint,
  p_repository_external_id bigint,
  p_repository_full_name text,
  p_payload_sha256 text,
  p_normalized_actions jsonb,
  p_received_at timestamptz,
  p_retention_until timestamptz,
  p_max_attempts integer default 8
)
returns table(outcome text, inbox_id text, job_id text)
language plpgsql
security invoker
as $$
declare
  v_inbox_id text;
  v_job_id text;
  v_existing_digest text;
begin
  insert into webhook_inbox (
    id, provider, delivery_id, event_type, event_action,
    installation_external_id, repository_external_id, repository_full_name,
    payload_version, payload_sha256, normalized_actions, state,
    received_at, last_received_at, retention_until
  ) values (
    p_inbox_id, p_provider, p_delivery_id, p_event_type, p_event_action,
    p_installation_external_id, p_repository_external_id, p_repository_full_name,
    1, p_payload_sha256, p_normalized_actions, 'accepted',
    p_received_at, p_received_at, p_retention_until
  )
  on conflict (provider, delivery_id) do nothing
  returning id into v_inbox_id;

  if v_inbox_id is null then
    select wi.id, wi.payload_sha256
      into v_inbox_id, v_existing_digest
      from webhook_inbox wi
     where wi.provider = p_provider and wi.delivery_id = p_delivery_id
     for update;

    update webhook_inbox
       set duplicate_count = duplicate_count + 1,
           duplicate_payload_mismatch_count = duplicate_payload_mismatch_count
             + case when v_existing_digest = p_payload_sha256 then 0 else 1 end,
           last_received_at = greatest(last_received_at, p_received_at)
     where id = v_inbox_id;

    select cpj.id into v_job_id
      from control_plane_jobs cpj
     where cpj.inbox_id = v_inbox_id;

    return query select 'duplicate'::text, v_inbox_id, v_job_id;
    return;
  end if;

  insert into control_plane_jobs (
    id, inbox_id, job_type, payload_version, idempotency_key,
    priority, status, available_at, attempt_count, max_attempts, created_at
  ) values (
    p_job_id, v_inbox_id, 'github_webhook.lifecycle', 1,
    p_provider || ':' || p_delivery_id, 100, 'available', p_received_at, 0, p_max_attempts, p_received_at
  )
  returning id into v_job_id;

  return query select 'accepted'::text, v_inbox_id, v_job_id;
end;
$$;

create or replace function boardreadyops_claim_control_plane_jobs(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  job_id text,
  inbox_id text,
  job_type text,
  payload_version integer,
  attempt_count integer,
  event_type text,
  event_action text,
  delivery_id text,
  normalized_actions jsonb
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpj.id, cpj.inbox_id, cpj.attempt_count, cpj.max_attempts
      from control_plane_jobs cpj
     where cpj.status = 'leased' and cpj.lease_expires_at <= p_now
     for update skip locked
  ), terminalized as (
    update control_plane_jobs cpj
       set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
           available_at = case when expired.attempt_count >= expired.max_attempts then cpj.available_at else p_now end,
           lease_owner = null,
           lease_expires_at = null,
           completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
           last_error_class = 'lease_expired',
           last_error_message = 'The worker lease expired before the job reached a terminal state.'
      from expired
     where cpj.id = expired.id
    returning cpj.inbox_id, cpj.status
  )
  update webhook_inbox wi
     set state = case when terminalized.status = 'dead_letter' then 'dead_letter' else 'accepted' end,
         processing_started_at = null,
         processed_at = case when terminalized.status = 'dead_letter' then p_now else null end,
         last_error_class = 'lease_expired',
         last_error_message = 'The worker lease expired before the job reached a terminal state.'
    from terminalized
   where wi.id = terminalized.inbox_id;

  return query
  with candidates as (
    select cpj.id
      from control_plane_jobs cpj
     where cpj.status = 'available' and cpj.available_at <= p_now
     order by cpj.priority asc, cpj.available_at asc, cpj.created_at asc, cpj.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_jobs cpj
       set status = 'leased',
           attempt_count = cpj.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = p_lease_expires_at,
           started_at = coalesce(cpj.started_at, p_now),
           last_error_class = null,
           last_error_message = null
      from candidates
     where cpj.id = candidates.id
    returning cpj.*
  ), marked_inbox as (
    update webhook_inbox wi
       set state = 'processing',
           processing_started_at = p_now,
           processed_at = null,
           last_error_class = null,
           last_error_message = null
      from claimed
     where wi.id = claimed.inbox_id
    returning wi.id
  )
  select claimed.id, claimed.inbox_id, claimed.job_type, claimed.payload_version,
         claimed.attempt_count, wi.event_type, wi.event_action, wi.delivery_id, wi.normalized_actions
    from claimed
    join webhook_inbox wi on wi.id = claimed.inbox_id
    join marked_inbox on marked_inbox.id = wi.id
   order by claimed.priority asc, claimed.available_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_complete_control_plane_job(
  p_job_id text,
  p_worker_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
declare
  v_inbox_id text;
begin
  update control_plane_jobs
     set status = 'completed', lease_owner = null, lease_expires_at = null,
         completed_at = p_now, last_error_class = null, last_error_message = null
   where id = p_job_id and status = 'leased' and lease_owner = p_worker_id
  returning inbox_id into v_inbox_id;

  if v_inbox_id is null then
    return 'stale';
  end if;

  update webhook_inbox
     set state = 'processed', processed_at = p_now,
         normalized_actions = '[]'::jsonb,
         last_error_class = null, last_error_message = null
   where id = v_inbox_id;
  return 'completed';
end;
$$;

create or replace function boardreadyops_fail_control_plane_job(
  p_job_id text,
  p_worker_id text,
  p_now timestamptz,
  p_retry_at timestamptz,
  p_error_class text,
  p_error_message text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_inbox_id text;
  v_attempt_count integer;
  v_max_attempts integer;
  v_outcome text;
begin
  select cpj.inbox_id, cpj.attempt_count, cpj.max_attempts
    into v_inbox_id, v_attempt_count, v_max_attempts
    from control_plane_jobs cpj
   where cpj.id = p_job_id and cpj.status = 'leased' and cpj.lease_owner = p_worker_id
   for update;

  if v_inbox_id is null then
    return 'stale';
  end if;

  v_outcome := case when v_attempt_count >= v_max_attempts then 'dead_letter' else 'retry' end;

  update control_plane_jobs
     set status = case when v_outcome = 'dead_letter' then 'dead_letter' else 'available' end,
         available_at = case when v_outcome = 'dead_letter' then available_at else p_retry_at end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when v_outcome = 'dead_letter' then p_now else null end,
         last_error_class = left(p_error_class, 100),
         last_error_message = left(p_error_message, 1000)
   where id = p_job_id;

  update webhook_inbox
     set state = case when v_outcome = 'dead_letter' then 'dead_letter' else 'accepted' end,
         processing_started_at = null,
         processed_at = case when v_outcome = 'dead_letter' then p_now else null end,
         last_error_class = left(p_error_class, 100),
         last_error_message = left(p_error_message, 1000)
   where id = v_inbox_id;

  return v_outcome;
end;
$$;


create or replace function boardreadyops_purge_expired_webhook_inbox(
  p_now timestamptz,
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_purged integer;
begin
  with expired as (
    select wi.id
      from webhook_inbox wi
     where wi.retention_until <= p_now
       and wi.state in ('processed', 'failed', 'dead_letter')
     order by wi.retention_until asc, wi.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 10000))
  )
  delete from webhook_inbox wi
   using expired
   where wi.id = expired.id;

  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;
