create table if not exists control_plane_outbox (
  id text primary key,
  release_run_id text references release_runs(id) on delete cascade,
  execution_attempt_id text references release_run_attempts(id) on delete cascade,
  effect_type text not null,
  payload_version integer not null default 1,
  idempotency_key text not null unique,
  payload jsonb not null,
  priority smallint not null default 100,
  status text not null default 'available',
  available_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  delivery_started_at timestamptz,
  completed_at timestamptz,
  external_result jsonb,
  last_error_class text,
  last_error_message text,
  constraint control_plane_outbox_effect_type_valid check (
    effect_type in (
      'github.check_run.create',
      'github.check_run.complete',
      'github.workflow.dispatch'
    )
  ),
  constraint control_plane_outbox_payload_version_valid check (payload_version = 1),
  constraint control_plane_outbox_idempotency_key_valid check (
    char_length(idempotency_key) between 1 and 256
  ),
  constraint control_plane_outbox_payload_valid check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144
  ),
  constraint control_plane_outbox_priority_valid check (priority between 0 and 1000),
  constraint control_plane_outbox_status_valid check (
    status in ('available', 'leased', 'completed', 'dead_letter', 'reconciliation_required')
  ),
  constraint control_plane_outbox_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint control_plane_outbox_lease_valid check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint control_plane_outbox_completion_valid check (
    (status in ('completed', 'dead_letter', 'reconciliation_required') and completed_at is not null)
    or (status not in ('completed', 'dead_letter', 'reconciliation_required') and completed_at is null)
  ),
  constraint control_plane_outbox_external_result_valid check (
    external_result is null
    or (jsonb_typeof(external_result) = 'object' and pg_column_size(external_result) <= 65536)
  ),
  constraint control_plane_outbox_attempt_scope_valid check (
    execution_attempt_id is null or release_run_id is not null
  )
);

create index if not exists control_plane_outbox_claim_idx
  on control_plane_outbox(priority, available_at, created_at, id)
  where status = 'available';

create index if not exists control_plane_outbox_lease_expiry_idx
  on control_plane_outbox(lease_expires_at, id)
  where status = 'leased';

create index if not exists control_plane_outbox_dead_letter_idx
  on control_plane_outbox(completed_at desc, id desc)
  where status in ('dead_letter', 'reconciliation_required');

create index if not exists control_plane_outbox_release_run_idx
  on control_plane_outbox(release_run_id, created_at, id)
  where release_run_id is not null;

create or replace function boardreadyops_claim_control_plane_outbox(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  outbox_id text,
  release_run_id text,
  execution_attempt_id text,
  effect_type text,
  payload_version integer,
  idempotency_key text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpo.id, cpo.effect_type, cpo.delivery_started_at,
           cpo.attempt_count, cpo.max_attempts
      from control_plane_outbox cpo
     where cpo.status = 'leased'
       and cpo.lease_expires_at <= p_now
     for update skip locked
  )
  update control_plane_outbox cpo
     set status = case
           when expired.effect_type = 'github.workflow.dispatch'
             and expired.delivery_started_at is not null
             then 'reconciliation_required'
           when expired.attempt_count >= expired.max_attempts
             then 'dead_letter'
           else 'available'
         end,
         available_at = case
           when expired.attempt_count >= expired.max_attempts
             or (
               expired.effect_type = 'github.workflow.dispatch'
               and expired.delivery_started_at is not null
             )
             then cpo.available_at
           else p_now
         end,
         lease_owner = null,
         lease_expires_at = null,
         delivery_started_at = case
           when expired.effect_type = 'github.workflow.dispatch'
             and expired.delivery_started_at is not null
             then cpo.delivery_started_at
           else null
         end,
         completed_at = case
           when expired.attempt_count >= expired.max_attempts
             or (
               expired.effect_type = 'github.workflow.dispatch'
               and expired.delivery_started_at is not null
             )
             then p_now
           else null
         end,
         last_error_class = case
           when expired.effect_type = 'github.workflow.dispatch'
             and expired.delivery_started_at is not null
             then 'delivery_uncertain'
           else 'lease_expired'
         end,
         last_error_message = case
           when expired.effect_type = 'github.workflow.dispatch'
             and expired.delivery_started_at is not null
             then 'Workflow dispatch delivery began but completion was not recorded; operator reconciliation is required before replay.'
           else 'The outbox worker lease expired before the effect reached a terminal state.'
         end
    from expired
   where cpo.id = expired.id;

  return query
  with candidates as (
    select cpo.id
      from control_plane_outbox cpo
     where cpo.status = 'available'
       and cpo.available_at <= p_now
     order by cpo.priority asc, cpo.available_at asc, cpo.created_at asc, cpo.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_outbox cpo
       set status = 'leased',
           attempt_count = cpo.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = p_lease_expires_at,
           delivery_started_at = null,
           completed_at = null,
           last_error_class = null,
           last_error_message = null
      from candidates
     where cpo.id = candidates.id
    returning cpo.*
  )
  select claimed.id, claimed.release_run_id, claimed.execution_attempt_id,
         claimed.effect_type, claimed.payload_version, claimed.idempotency_key,
         claimed.payload, claimed.attempt_count
    from claimed
   order by claimed.priority asc, claimed.available_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_mark_control_plane_outbox_delivery_started(
  p_outbox_id text,
  p_worker_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
begin
  update control_plane_outbox
     set delivery_started_at = coalesce(delivery_started_at, p_now)
   where id = p_outbox_id
     and status = 'leased'
     and lease_owner = p_worker_id;

  if not found then
    return 'stale';
  end if;

  return 'started';
end;
$$;

create or replace function boardreadyops_complete_control_plane_outbox(
  p_outbox_id text,
  p_worker_id text,
  p_now timestamptz,
  p_external_result jsonb default null
)
returns text
language plpgsql
security invoker
as $$
begin
  update control_plane_outbox
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = p_now,
         external_result = p_external_result,
         last_error_class = null,
         last_error_message = null
   where id = p_outbox_id
     and status = 'leased'
     and lease_owner = p_worker_id;

  if not found then
    return 'stale';
  end if;

  return 'completed';
end;
$$;

create or replace function boardreadyops_fail_control_plane_outbox(
  p_outbox_id text,
  p_worker_id text,
  p_now timestamptz,
  p_retry_at timestamptz,
  p_error_class text,
  p_error_message text,
  p_delivery_uncertain boolean default false
)
returns text
language plpgsql
security invoker
as $$
declare
  v_effect_type text;
  v_attempt_count integer;
  v_max_attempts integer;
  v_outcome text;
begin
  select cpo.effect_type, cpo.attempt_count, cpo.max_attempts
    into v_effect_type, v_attempt_count, v_max_attempts
    from control_plane_outbox cpo
   where cpo.id = p_outbox_id
     and cpo.status = 'leased'
     and cpo.lease_owner = p_worker_id
   for update;

  if v_effect_type is null then
    return 'stale';
  end if;

  v_outcome := case
    when p_delivery_uncertain and v_effect_type = 'github.workflow.dispatch'
      then 'reconciliation_required'
    when v_attempt_count >= v_max_attempts
      then 'dead_letter'
    else 'retry'
  end;

  update control_plane_outbox
     set status = case when v_outcome = 'retry' then 'available' else v_outcome end,
         available_at = case when v_outcome = 'retry' then p_retry_at else available_at end,
         lease_owner = null,
         lease_expires_at = null,
         delivery_started_at = case when v_outcome = 'retry' then null else delivery_started_at end,
         completed_at = case when v_outcome = 'retry' then null else p_now end,
         last_error_class = left(p_error_class, 100),
         last_error_message = left(p_error_message, 1000)
   where id = p_outbox_id;

  return v_outcome;
end;
$$;

create or replace function boardreadyops_replay_control_plane_outbox(
  p_outbox_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
begin
  update control_plane_outbox
     set status = 'available',
         available_at = p_now,
         attempt_count = 0,
         lease_owner = null,
         lease_expires_at = null,
         delivery_started_at = null,
         completed_at = null,
         external_result = null,
         last_error_class = null,
         last_error_message = null
   where id = p_outbox_id
     and status = 'dead_letter'
     and status <> 'reconciliation_required';

  if not found then
    return 'not_replayable';
  end if;

  return 'replayed';
end;
$$;
