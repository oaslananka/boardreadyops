-- Tenant-scoped dead-letter operations, durable reconciliation work, and privacy-safe SLIs.

alter table webhook_inbox
  add column if not exists accepted_at timestamptz not null default clock_timestamp();

create index if not exists webhook_inbox_installation_accepted_idx
  on webhook_inbox(installation_external_id, accepted_at desc, id)
  where installation_external_id is not null;

create table if not exists control_plane_replay_operations (
  operation_id text primary key,
  installation_id text not null references installations(id) on delete cascade,
  item_type text not null,
  item_id text not null,
  actor_id text not null,
  outcome text not null,
  audit_event_id text references audit_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint control_plane_replay_operation_id_valid check (
    char_length(operation_id) between 1 and 128
  ),
  constraint control_plane_replay_item_type_valid check (item_type in ('job', 'outbox')),
  constraint control_plane_replay_item_id_valid check (char_length(item_id) between 1 and 128),
  constraint control_plane_replay_actor_id_valid check (char_length(actor_id) between 1 and 128),
  constraint control_plane_replay_outcome_valid check (
    outcome in ('not_found', 'not_replayable', 'replayed')
  )
);

create index if not exists control_plane_replay_operations_installation_created_idx
  on control_plane_replay_operations(installation_id, created_at desc, operation_id desc);

create table if not exists control_plane_reconciliation_items (
  id text primary key,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text references repositories(id) on delete cascade,
  release_run_id text references release_runs(id) on delete cascade,
  execution_attempt_id text references release_run_attempts(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  reason_code text not null,
  status text not null default 'available',
  deadline_at timestamptz not null,
  next_check_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 12,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome_code text,
  repaired boolean not null default false,
  public_failure_reason text,
  last_error_class text,
  last_error_message text,
  constraint control_plane_reconciliation_subject_type_valid check (
    subject_type in ('job', 'outbox', 'release_run', 'execution_attempt')
  ),
  constraint control_plane_reconciliation_subject_id_valid check (
    char_length(subject_id) between 1 and 128
  ),
  constraint control_plane_reconciliation_reason_code_valid check (
    char_length(reason_code) between 1 and 128
    and reason_code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  constraint control_plane_reconciliation_status_valid check (
    status in ('available', 'leased', 'completed', 'dead_letter')
  ),
  constraint control_plane_reconciliation_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint control_plane_reconciliation_lease_valid check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint control_plane_reconciliation_completion_valid check (
    (status in ('completed', 'dead_letter') and completed_at is not null)
    or (status not in ('completed', 'dead_letter') and completed_at is null)
  ),
  constraint control_plane_reconciliation_dimensions_valid check (
    (release_run_id is null or repository_id is not null)
    and (execution_attempt_id is null or release_run_id is not null)
  ),
  constraint control_plane_reconciliation_outcome_code_valid check (
    outcome_code is null
    or (
      char_length(outcome_code) between 1 and 128
      and outcome_code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
  ),
  constraint control_plane_reconciliation_public_failure_valid check (
    public_failure_reason is null or char_length(public_failure_reason) between 1 and 256
  ),
  constraint control_plane_reconciliation_error_class_valid check (
    last_error_class is null or char_length(last_error_class) between 1 and 100
  ),
  constraint control_plane_reconciliation_error_message_valid check (
    last_error_message is null or char_length(last_error_message) between 1 and 1000
  )
);

create index if not exists control_plane_reconciliation_claim_idx
  on control_plane_reconciliation_items(next_check_at, deadline_at, created_at, id)
  where status = 'available';

create index if not exists control_plane_reconciliation_lease_expiry_idx
  on control_plane_reconciliation_items(lease_expires_at, id)
  where status = 'leased';

create index if not exists control_plane_reconciliation_installation_status_idx
  on control_plane_reconciliation_items(installation_id, status, next_check_at, id);

create unique index if not exists control_plane_reconciliation_active_subject_idx
  on control_plane_reconciliation_items(installation_id, subject_type, subject_id, reason_code)
  where status in ('available', 'leased');

create or replace function boardreadyops_validate_reconciliation_scope()
returns trigger
language plpgsql
as $$
declare
  v_installation_id text;
  v_repository_id text;
  v_release_run_id text;
  v_execution_attempt_id text;
begin
  if new.subject_type = 'job' then
    select i.id, r.id
      into v_installation_id, v_repository_id
      from control_plane_jobs cpj
      join webhook_inbox wi on wi.id = cpj.inbox_id
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
     where cpj.id = new.subject_id;
  elsif new.subject_type = 'outbox' then
    select i.id, r.id, rr.id, cpo.execution_attempt_id
      into v_installation_id, v_repository_id, v_release_run_id, v_execution_attempt_id
      from control_plane_outbox cpo
      join release_runs rr on rr.id = cpo.release_run_id
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where cpo.id = new.subject_id;
  elsif new.subject_type = 'release_run' then
    select i.id, r.id, rr.id
      into v_installation_id, v_repository_id, v_release_run_id
      from release_runs rr
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where rr.id = new.subject_id;
  elsif new.subject_type = 'execution_attempt' then
    select i.id, r.id, rr.id, rra.id
      into v_installation_id, v_repository_id, v_release_run_id, v_execution_attempt_id
      from release_run_attempts rra
      join release_runs rr on rr.id = rra.run_id
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where rra.id = new.subject_id;
  end if;

  if v_installation_id is null then
    raise exception 'reconciliation subject was not found' using errcode = '23503';
  end if;

  if new.installation_id <> v_installation_id then
    raise exception 'reconciliation subject does not belong to installation' using errcode = '23514';
  end if;

  if new.repository_id is not null and new.repository_id is distinct from v_repository_id then
    raise exception 'reconciliation repository scope does not match subject' using errcode = '23514';
  end if;

  if new.release_run_id is not null and new.release_run_id is distinct from v_release_run_id then
    raise exception 'reconciliation release-run scope does not match subject' using errcode = '23514';
  end if;

  if new.execution_attempt_id is not null
     and new.execution_attempt_id is distinct from v_execution_attempt_id then
    raise exception 'reconciliation attempt scope does not match subject' using errcode = '23514';
  end if;

  new.repository_id := coalesce(new.repository_id, v_repository_id);
  new.release_run_id := coalesce(new.release_run_id, v_release_run_id);
  new.execution_attempt_id := coalesce(new.execution_attempt_id, v_execution_attempt_id);
  return new;
end;
$$;

drop trigger if exists control_plane_reconciliation_validate_scope on control_plane_reconciliation_items;
create trigger control_plane_reconciliation_validate_scope
  before insert or update of installation_id, repository_id, release_run_id,
    execution_attempt_id, subject_type, subject_id
  on control_plane_reconciliation_items
  for each row execute function boardreadyops_validate_reconciliation_scope();

create or replace function boardreadyops_list_control_plane_dead_letters(
  p_installation_id text,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns table(
  item_type text,
  item_id text,
  installation_id text,
  repository_id text,
  repository_full_name text,
  release_run_id text,
  execution_attempt_id text,
  reason_code text,
  error_class text,
  attempt_count integer,
  failed_at timestamptz,
  replay_safe boolean
)
language sql
security invoker
as $$
  select *
    from (
      select
        'job'::text as item_type,
        cpj.id as item_id,
        i.id as installation_id,
        r.id as repository_id,
        wi.repository_full_name,
        null::text as release_run_id,
        null::text as execution_attempt_id,
        case
          when cpj.last_error_class = 'lease_expired' then 'lease_expired'
          else 'retry_exhausted'
        end::text as reason_code,
        cpj.last_error_class as error_class,
        cpj.attempt_count,
        cpj.completed_at as failed_at,
        true as replay_safe
      from control_plane_jobs cpj
      join webhook_inbox wi on wi.id = cpj.inbox_id
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
      where i.id = p_installation_id
        and cpj.status = 'dead_letter'
        and (p_before is null or cpj.completed_at < p_before)

      union all

      select
        'outbox'::text as item_type,
        cpo.id as item_id,
        i.id as installation_id,
        r.id as repository_id,
        r.owner || '/' || r.name as repository_full_name,
        cpo.release_run_id,
        cpo.execution_attempt_id,
        case
          when cpo.status = 'reconciliation_required' then 'delivery_uncertain'
          when cpo.last_error_class = 'lease_expired' then 'lease_expired'
          else 'retry_exhausted'
        end::text as reason_code,
        cpo.last_error_class as error_class,
        cpo.attempt_count,
        cpo.completed_at as failed_at,
        cpo.status = 'dead_letter' as replay_safe
      from control_plane_outbox cpo
      join release_runs rr on rr.id = cpo.release_run_id
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
      where i.id = p_installation_id
        and cpo.status in ('dead_letter', 'reconciliation_required')
        and (p_before is null or cpo.completed_at < p_before)
    ) dead_letters
   order by failed_at desc, item_type asc, item_id desc
   limit greatest(1, least(p_limit, 100));
$$;

create or replace function boardreadyops_replay_control_plane_dead_letter(
  p_installation_id text,
  p_item_type text,
  p_item_id text,
  p_operation_id text,
  p_actor_id text,
  p_now timestamptz
)
returns table(outcome text, audit_event_id text)
language plpgsql
security invoker
as $$
declare
  v_existing control_plane_replay_operations%rowtype;
  v_repository_id text;
  v_release_run_id text;
  v_audit_event_id text;
  v_outcome text;
begin
  select * into v_existing
    from control_plane_replay_operations
   where operation_id = p_operation_id
   for update;

  if found then
    if v_existing.installation_id <> p_installation_id
       or v_existing.item_type <> p_item_type
       or v_existing.item_id <> p_item_id
       or v_existing.actor_id <> p_actor_id then
      raise exception 'replay operation id was reused for a different request' using errcode = '23505';
    end if;
    return query select 'already_applied'::text, v_existing.audit_event_id;
    return;
  end if;

  if p_item_type = 'job' then
    select r.id
      into v_repository_id
      from control_plane_jobs cpj
      join webhook_inbox wi on wi.id = cpj.inbox_id
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
     where cpj.id = p_item_id
       and i.id = p_installation_id;

    if not found then
      v_outcome := 'not_found';
    elsif not exists (
      select 1 from control_plane_jobs where id = p_item_id and status = 'dead_letter'
    ) then
      v_outcome := 'not_replayable';
    else
      update control_plane_jobs
         set status = 'available',
             available_at = p_now,
             attempt_count = 0,
             lease_owner = null,
             lease_expires_at = null,
             started_at = null,
             completed_at = null,
             last_error_class = null,
             last_error_message = null
       where id = p_item_id
         and status = 'dead_letter';

      update webhook_inbox wi
         set state = 'accepted',
             processing_started_at = null,
             processed_at = null,
             last_error_class = null,
             last_error_message = null
        from control_plane_jobs cpj
       where cpj.id = p_item_id
         and wi.id = cpj.inbox_id;
      v_outcome := 'replayed';
    end if;
  elsif p_item_type = 'outbox' then
    select r.id, rr.id
      into v_repository_id, v_release_run_id
      from control_plane_outbox cpo
      join release_runs rr on rr.id = cpo.release_run_id
      join repositories r on r.id = rr.repository_id
     where cpo.id = p_item_id
       and r.installation_id = p_installation_id;

    if not found then
      v_outcome := 'not_found';
    elsif exists (
      select 1
        from control_plane_outbox
       where id = p_item_id
         and status = 'reconciliation_required'
    ) then
      return query select 'not_replayable'::text, null::text;
      insert into control_plane_replay_operations (
        operation_id, installation_id, item_type, item_id, actor_id, outcome, created_at
      ) values (
        p_operation_id, p_installation_id, p_item_type, p_item_id, p_actor_id,
        'not_replayable', p_now
      );
      return;
    elsif not exists (
      select 1 from control_plane_outbox where id = p_item_id and status = 'dead_letter'
    ) then
      v_outcome := 'not_replayable';
    else
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
       where id = p_item_id
         and status = 'dead_letter';
      v_outcome := 'replayed';
    end if;
  else
    raise exception 'unsupported dead-letter item type' using errcode = '22023';
  end if;

  if v_outcome = 'replayed' then
    v_audit_event_id := gen_random_uuid()::text;
    insert into audit_events (
      id, installation_id, event_type, actor_type, actor_id,
      subject_type, subject_id, repository_id, release_run_id,
      request_id, metadata, created_at
    ) values (
      v_audit_event_id, p_installation_id, 'control_plane.dead_letter_replayed',
      'operator', p_actor_id,
      case when p_item_type = 'job' then 'control_plane_job' else 'control_plane_outbox' end,
      p_item_id, v_repository_id, v_release_run_id,
      p_operation_id,
      jsonb_build_object('itemType', p_item_type, 'outcome', v_outcome),
      p_now
    );
  end if;

  insert into control_plane_replay_operations (
    operation_id, installation_id, item_type, item_id, actor_id,
    outcome, audit_event_id, created_at
  ) values (
    p_operation_id, p_installation_id, p_item_type, p_item_id, p_actor_id,
    v_outcome, v_audit_event_id, p_now
  );

  return query select v_outcome, v_audit_event_id;
end;
$$;

create or replace function boardreadyops_enqueue_control_plane_reconciliation(
  p_id text,
  p_installation_id text,
  p_repository_id text,
  p_release_run_id text,
  p_execution_attempt_id text,
  p_subject_type text,
  p_subject_id text,
  p_reason_code text,
  p_deadline_at timestamptz,
  p_next_check_at timestamptz,
  p_max_attempts integer,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
begin
  insert into control_plane_reconciliation_items (
    id, installation_id, repository_id, release_run_id, execution_attempt_id,
    subject_type, subject_id, reason_code, status,
    deadline_at, next_check_at, attempt_count, max_attempts, created_at
  ) values (
    p_id, p_installation_id, p_repository_id, p_release_run_id, p_execution_attempt_id,
    p_subject_type, p_subject_id, p_reason_code, 'available',
    p_deadline_at, p_next_check_at, 0, p_max_attempts, p_now
  )
  on conflict (installation_id, subject_type, subject_id, reason_code)
    where status in ('available', 'leased')
  do nothing;

  if not found then
    return 'existing';
  end if;
  return 'enqueued';
end;
$$;

create or replace function boardreadyops_claim_control_plane_reconciliation(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  reconciliation_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  execution_attempt_id text,
  subject_type text,
  subject_id text,
  reason_code text,
  deadline_at timestamptz,
  next_check_at timestamptz,
  attempt_count integer
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpri.id, cpri.attempt_count, cpri.max_attempts
      from control_plane_reconciliation_items cpri
     where cpri.status = 'leased'
       and cpri.lease_expires_at <= p_now
     for update skip locked
  )
  update control_plane_reconciliation_items cpri
     set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
         next_check_at = case when expired.attempt_count >= expired.max_attempts then cpri.next_check_at else p_now end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
         public_failure_reason = case
           when expired.attempt_count >= expired.max_attempts then 'operator_replay_required'
           else null
         end,
         last_error_class = 'lease_expired',
         last_error_message = 'The reconciliation lease expired before the item reached a terminal state.'
    from expired
   where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
      from control_plane_reconciliation_items cpri
     where cpri.status = 'available'
       and cpri.next_check_at <= p_now
     order by cpri.next_check_at asc, cpri.deadline_at asc, cpri.created_at asc, cpri.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_reconciliation_items cpri
       set status = 'leased',
           attempt_count = cpri.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = p_lease_expires_at,
           completed_at = null,
           outcome_code = null,
           repaired = false,
           public_failure_reason = null,
           last_error_class = null,
           last_error_message = null
      from candidates
     where cpri.id = candidates.id
    returning cpri.*
  )
  select claimed.id, claimed.installation_id, claimed.repository_id,
         claimed.release_run_id, claimed.execution_attempt_id,
         claimed.subject_type, claimed.subject_id, claimed.reason_code,
         claimed.deadline_at, claimed.next_check_at, claimed.attempt_count
    from claimed
   order by claimed.next_check_at asc, claimed.deadline_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_complete_control_plane_reconciliation(
  p_id text,
  p_worker_id text,
  p_now timestamptz,
  p_outcome_code text,
  p_repaired boolean,
  p_public_failure_reason text default null
)
returns text
language plpgsql
security invoker
as $$
declare
  v_item control_plane_reconciliation_items%rowtype;
begin
  update control_plane_reconciliation_items
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = p_now,
         outcome_code = p_outcome_code,
         repaired = p_repaired,
         public_failure_reason = p_public_failure_reason,
         last_error_class = null,
         last_error_message = null
   where id = p_id
     and status = 'leased'
     and lease_owner = p_worker_id
  returning * into v_item;

  if v_item.id is null then
    return 'stale';
  end if;

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, release_run_id,
    metadata, created_at
  ) values (
    gen_random_uuid()::text, v_item.installation_id,
    'control_plane.reconciliation_completed', 'system', p_worker_id,
    'control_plane_reconciliation', v_item.id,
    v_item.repository_id, v_item.release_run_id,
    jsonb_build_object(
      'reasonCode', v_item.reason_code,
      'outcomeCode', p_outcome_code,
      'repaired', p_repaired,
      'publicFailureReason', p_public_failure_reason
    ),
    p_now
  );

  return 'completed';
end;
$$;

create or replace function boardreadyops_fail_control_plane_reconciliation(
  p_id text,
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
  v_item control_plane_reconciliation_items%rowtype;
  v_outcome text;
begin
  select * into v_item
    from control_plane_reconciliation_items
   where id = p_id
     and status = 'leased'
     and lease_owner = p_worker_id
   for update;

  if v_item.id is null then
    return 'stale';
  end if;

  v_outcome := case when v_item.attempt_count >= v_item.max_attempts then 'dead_letter' else 'retry' end;

  update control_plane_reconciliation_items
     set status = case when v_outcome = 'dead_letter' then 'dead_letter' else 'available' end,
         next_check_at = case when v_outcome = 'dead_letter' then next_check_at else p_retry_at end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when v_outcome = 'dead_letter' then p_now else null end,
         public_failure_reason = case
           when v_outcome = 'dead_letter' then 'operator_replay_required'
           else null
         end,
         last_error_class = left(p_error_class, 100),
         last_error_message = left(p_error_message, 1000)
   where id = p_id;

  if v_outcome = 'dead_letter' then
    insert into audit_events (
      id, installation_id, event_type, actor_type, actor_id,
      subject_type, subject_id, repository_id, release_run_id,
      metadata, created_at
    ) values (
      gen_random_uuid()::text, v_item.installation_id,
      'control_plane.reconciliation_dead_lettered', 'system', p_worker_id,
      'control_plane_reconciliation', v_item.id,
      v_item.repository_id, v_item.release_run_id,
      jsonb_build_object('reasonCode', v_item.reason_code, 'outcome', v_outcome),
      p_now
    );
  end if;

  return v_outcome;
end;
$$;

create index if not exists release_run_attempts_dispatch_latency_idx
  on release_run_attempts(dispatch_requested_at, dispatched_at)
  where dispatched_at is not null;

create index if not exists release_run_attempts_completion_latency_idx
  on release_run_attempts(completed_at, created_at)
  where completed_at is not null;

create or replace function boardreadyops_control_plane_sli_snapshot(
  p_installation_id text default null,
  p_now timestamptz default now()
)
returns table(
  webhook_acceptance_p95_ms bigint,
  lifecycle_queue_age_seconds bigint,
  outbox_lag_seconds bigint,
  dispatch_latency_p95_seconds bigint,
  completion_latency_p95_seconds bigint,
  stale_attempts bigint,
  reconciliation_backlog bigint,
  reconciliation_repairs_24h bigint,
  terminal_failures_24h bigint,
  terminal_runs_24h bigint,
  terminal_failure_rate_basis_points bigint
)
language sql
security invoker
as $$
  with scoped_repositories as (
    select r.id, r.github_repo_id, i.github_installation_id
      from repositories r
      join installations i on i.id = r.installation_id
     where p_installation_id is null or i.id = p_installation_id
  ), scoped_webhooks as (
    select wi.*
      from webhook_inbox wi
      join installations i on i.github_installation_id = wi.installation_external_id
     where (p_installation_id is null or i.id = p_installation_id)
       and wi.received_at >= p_now - interval '24 hours'
  ), scoped_runs as (
    select rr.*
      from release_runs rr
      join repositories r on r.id = rr.repository_id
     where p_installation_id is null or r.installation_id = p_installation_id
  ), scoped_attempts as (
    select rra.*
      from release_run_attempts rra
      join scoped_runs rr on rr.id = rra.run_id
  ), scoped_outbox as (
    select cpo.*
      from control_plane_outbox cpo
      join scoped_runs rr on rr.id = cpo.release_run_id
  ), scoped_reconciliation as (
    select cpri.*
      from control_plane_reconciliation_items cpri
     where p_installation_id is null or cpri.installation_id = p_installation_id
  ), values as (
    select
      coalesce((
        select round(percentile_cont(0.95) within group (
          order by greatest(0, extract(epoch from (accepted_at - received_at)) * 1000)
        ))::bigint
          from scoped_webhooks
      ), 0)::bigint as webhook_acceptance_p95_ms,
      coalesce((
        select greatest(0, floor(extract(epoch from (p_now - min(wi.received_at)))))::bigint
          from control_plane_jobs cpj
          join webhook_inbox wi on wi.id = cpj.inbox_id
          join installations i on i.github_installation_id = wi.installation_external_id
         where cpj.status in ('available', 'leased')
           and (p_installation_id is null or i.id = p_installation_id)
      ), 0)::bigint as lifecycle_queue_age_seconds,
      coalesce((
        select greatest(0, floor(extract(epoch from (p_now - min(created_at)))))::bigint
          from scoped_outbox
         where status in ('available', 'leased', 'reconciliation_required')
      ), 0)::bigint as outbox_lag_seconds,
      coalesce((
        select round(percentile_cont(0.95) within group (
          order by greatest(0, extract(epoch from (dispatched_at - dispatch_requested_at)))
        ))::bigint
          from scoped_attempts
         where dispatched_at is not null
           and dispatch_requested_at is not null
           and dispatched_at >= p_now - interval '24 hours'
      ), 0)::bigint as dispatch_latency_p95_seconds,
      coalesce((
        select round(percentile_cont(0.95) within group (
          order by greatest(0, extract(epoch from (completed_at - created_at)))
        ))::bigint
          from scoped_attempts
         where completed_at is not null
           and completed_at >= p_now - interval '24 hours'
      ), 0)::bigint as completion_latency_p95_seconds,
      coalesce((
        select count(*)::bigint
          from scoped_attempts
         where status in ('queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting')
           and coalesce(heartbeat_at, started_at, dispatched_at, dispatch_requested_at, created_at)
             < p_now - interval '15 minutes'
      ), 0)::bigint as stale_attempts,
      coalesce((
        select count(*)::bigint
          from scoped_reconciliation
         where status in ('available', 'leased')
      ), 0)::bigint as reconciliation_backlog,
      coalesce((
        select count(*)::bigint
          from scoped_reconciliation
         where status = 'completed'
           and repaired
           and completed_at >= p_now - interval '24 hours'
      ), 0)::bigint as reconciliation_repairs_24h,
      coalesce((
        select count(*)::bigint
          from scoped_runs
         where status in ('failed', 'timed_out')
           and completed_at >= p_now - interval '24 hours'
      ), 0)::bigint as terminal_failures_24h,
      coalesce((
        select count(*)::bigint
          from scoped_runs
         where status in ('completed', 'failed', 'timed_out', 'superseded')
           and completed_at >= p_now - interval '24 hours'
      ), 0)::bigint as terminal_runs_24h
  )
  select
    values.webhook_acceptance_p95_ms,
    values.lifecycle_queue_age_seconds,
    values.outbox_lag_seconds,
    values.dispatch_latency_p95_seconds,
    values.completion_latency_p95_seconds,
    values.stale_attempts,
    values.reconciliation_backlog,
    values.reconciliation_repairs_24h,
    values.terminal_failures_24h,
    values.terminal_runs_24h,
    case
      when values.terminal_runs_24h = 0 then 0
      else floor(values.terminal_failures_24h * 10000.0 / values.terminal_runs_24h)::bigint
    end as terminal_failure_rate_basis_points
  from values;
$$;
