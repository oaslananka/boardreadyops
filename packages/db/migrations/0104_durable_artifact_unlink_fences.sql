-- Persist the deletion/hold ordering across PostgreSQL client disconnects.
-- A fence is settled only after the local filesystem Promise has terminated AND
-- the existing completion/failure transition has committed. Do not time-expire
-- or automatically garbage collect unsettled fences after worker crashes.
-- Rollout must quiesce ALL pre-fencing physical-unlink workers before enabling
-- legal-hold acknowledgement; a mixed-version deployment is not safe.

create table if not exists public.artifact_unlink_fences (
  token uuid primary key,
  deletion_job_id text not null,
  tenant_key text not null check (tenant_key = lower(tenant_key) and char_length(tenant_key) between 1 and 256),
  worker_id text not null,
  started_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  outcome text check (outcome is null or outcome in ('deleted', 'missing', 'failed')),
  constraint artifact_unlink_fence_settlement_valid
    check ((settled_at is null and outcome is null) or (settled_at is not null and outcome is not null))
);
create unique index if not exists artifact_unlink_fences_active_job_idx
  on public.artifact_unlink_fences(deletion_job_id) where settled_at is null;
create index if not exists artifact_unlink_fences_active_tenant_idx
  on public.artifact_unlink_fences(tenant_key) where settled_at is null;

-- Shared deterministic lock key. Hash collisions only cause extra serialization,
-- never mistaken cross-tenant matching: the actual checks use exact tenant_key.
create or replace function boardreadyops_hold_unlink_lock_key(p_tenant text)
returns bigint language sql immutable strict parallel safe
set search_path = pg_catalog, public
as $$
  select hashtextextended('boardreadyops/hold-unlink/v1:' || lower(p_tenant), 0);
$$;

-- Any writer that inserts or reactivates an active legal hold is subject to
-- this trigger (not just the web UI). A hold must NOT be acknowledged while an
-- unresolved external unlink belonging to that GitHub tenant is possible.
create or replace function boardreadyops_guard_legal_hold_admission()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.active then
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'legal hold admission requires read committed isolation' using errcode = 'B4402';
    end if;
    -- A bounded wait is fail-closed, never a successful hold acknowledgement.
    perform set_config('lock_timeout', '5s', true);
    perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(new.tenant_id));
    if exists (
      select 1 from public.artifact_unlink_fences
      where tenant_key = lower(new.tenant_id) and settled_at is null
    ) then
      raise exception 'physical deletion in progress; hold not acknowledged'
        using errcode = 'B4401';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists boardreadyops_legal_hold_admission_guard on public.legal_holds;
create trigger boardreadyops_legal_hold_admission_guard
before insert or update of active, tenant_id, scope, scope_id on public.legal_holds
for each row execute function boardreadyops_guard_legal_hold_admission();

-- Renaming/removing an installation while a deletion is in flight must not
-- silently move the tenant key out from under the durable fence.
create or replace function boardreadyops_guard_installation_while_unlinking()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_old text := lower(old.account_login);
  v_new text;
begin
  if tg_op = 'UPDATE' then
    if new.account_login is not distinct from old.account_login then return new; end if;
    v_new := lower(new.account_login);
    if v_old = v_new then return new; end if;
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'installation change requires read committed isolation' using errcode = 'B4402';
  end if;
  perform set_config('lock_timeout', '5s', true);
  -- Stable acquisition order eliminates old/new tenant lock inversions.
  if v_new is not null and v_new < v_old then
    perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_new));
  end if;
  perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_old));
  if v_new is not null and v_new > v_old then
    perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_new));
  end if;
  if exists (
    select 1 from public.artifact_unlink_fences
    where settled_at is null and tenant_key in (v_old, v_new)
  ) then
    raise exception 'installation change blocked by in-progress physical deletion'
      using errcode = 'B4401';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists boardreadyops_installation_unlink_guard on public.installations;
create trigger boardreadyops_installation_unlink_guard
before update of account_login or delete on public.installations
for each row execute function boardreadyops_guard_installation_while_unlinking();

-- Fences must never lose their backing job through direct SQL mutations or
-- repository/run FK cascades. PostgreSQL invokes row DELETE triggers for
-- cascading referential actions; the job row is locked during admission, so a
-- concurrent cascade cannot race past a committed reservation.
create or replace function boardreadyops_guard_deletion_job_ownership()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.artifact_unlink_fences
    where deletion_job_id = old.id and settled_at is null
  ) then
    if tg_op = 'DELETE' then
      raise exception 'unresolved physical deletion fence prevents job removal'
        using errcode = 'B4401';
    end if;
    if row(new.artifact_id, new.installation_id, new.repository_id,
           new.release_run_id, new.storage_driver, new.storage_path)
       is distinct from
       row(old.artifact_id, old.installation_id, old.repository_id,
           old.release_run_id, old.storage_driver, old.storage_path) then
      raise exception 'unresolved physical deletion fence prevents job ownership change'
        using errcode = 'B4401';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists boardreadyops_deletion_job_fence_guard on public.artifact_deletion_jobs;
create trigger boardreadyops_deletion_job_fence_guard
before delete or update of artifact_id, installation_id, repository_id,
  release_run_id, storage_driver, storage_path on public.artifact_deletion_jobs
for each row execute function boardreadyops_guard_deletion_job_ownership();

-- TRUNCATE skips row triggers, including referential-action cascades that
-- truncate this table, so preserve unsettled job/fence pairs explicitly.
create or replace function boardreadyops_guard_deletion_job_truncate()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (select 1 from public.artifact_unlink_fences where settled_at is null) then
    raise exception 'unresolved physical deletion fences prevent job truncate'
      using errcode = 'B4401';
  end if;
  return null;
end;
$$;

drop trigger if exists boardreadyops_deletion_job_truncate_guard on public.artifact_deletion_jobs;
create trigger boardreadyops_deletion_job_truncate_guard
before truncate on public.artifact_deletion_jobs
for each statement execute function boardreadyops_guard_deletion_job_truncate();

-- Physical deletion obtains a durable reservation in the SAME transaction as
-- checking hold and lease. No pooled PG client is pinned across filesystem I/O.
create or replace function boardreadyops_begin_artifact_unlink(
  p_job_id text, p_worker_id text, p_token uuid
)
returns text language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_tenant text;
  v_current text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unlink admission requires read committed isolation' using errcode = 'B4402';
  end if;
  select lower(i.account_login) into v_tenant
    from public.artifact_deletion_jobs as j
    join public.installations as i on i.id = j.installation_id
   where j.id = p_job_id;
  if v_tenant is null then return 'stale'; end if;
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_tenant));
  select lower(i.account_login) into v_current
    from public.artifact_deletion_jobs as j
    join public.installations as i on i.id = j.installation_id
   where j.id = p_job_id and j.status = 'leased'
     and j.lease_owner = p_worker_id and j.lease_expires_at > clock_timestamp()
     and j.storage_driver = 'local'
   for update of j;
  if v_current is null or v_current <> v_tenant then return 'stale'; end if;
  if exists (select 1 from public.artifact_unlink_fences
             where deletion_job_id = p_job_id and settled_at is null)
  then return 'stale'; end if;
  if exists (select 1 from public.legal_holds
             where lower(tenant_id) = v_tenant and active = true)
  then
    update public.artifact_deletion_jobs
       set status = 'available',
           available_at = clock_timestamp() + interval '30 minutes',
           lease_owner = null, lease_expires_at = null,
           attempt_count = greatest(0, attempt_count - 1),
           last_error_class = 'legal_hold',
           last_error_message = 'Deletion deferred by active legal hold.'
     where id = p_job_id;
    return 'held';
  end if;
  insert into public.artifact_unlink_fences(token, deletion_job_id, tenant_key, worker_id)
  values (p_token, p_job_id, v_tenant, p_worker_id);
  return 'authorized';
end;
$$;

create or replace function boardreadyops_settle_artifact_unlink(
  p_job_id text, p_worker_id text, p_token uuid, p_outcome text
)
returns text language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_outcome not in ('deleted', 'missing', 'failed') then
    raise exception 'invalid physical unlink settlement outcome' using errcode = '22023';
  end if;
  -- A caller with a token cannot release a fence until durable completion
  -- or failure state has been committed. The filesystem Promise must also
  -- have terminated; that last condition is enforced by the worker.
  update public.artifact_unlink_fences as fence
     set settled_at = clock_timestamp(), outcome = p_outcome
    from public.artifact_deletion_jobs as job
   where fence.token = p_token
     and fence.deletion_job_id = p_job_id
     and fence.worker_id = p_worker_id
     and fence.settled_at is null
     and job.id = fence.deletion_job_id
     and (
       (p_outcome in ('deleted', 'missing')
         and job.status = 'completed' and job.deletion_outcome = p_outcome)
       or
       (p_outcome = 'failed' and job.status in ('available', 'dead_letter')
         and job.last_error_class is not null)
     );
  if found then return 'settled'; end if;
  return 'stale';
end;
$$;

-- Never auto-reclaim expired leased jobs while their physical unlink is
-- unresolved; the old process could still be running after DB disconnect.
-- The claim contract/signature/audit logic is otherwise unchanged.
create or replace function boardreadyops_claim_artifact_deletions(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  deletion_job_id text,
  artifact_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  storage_driver text,
  storage_path text,
  deletion_reason text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  with expired as (
    select artifact_deletion_jobs.id,
           artifact_deletion_jobs.attempt_count,
           artifact_deletion_jobs.max_attempts
    from public.artifact_deletion_jobs
    where artifact_deletion_jobs.status = 'leased'
      and artifact_deletion_jobs.lease_expires_at <= p_now
      and not exists (
        select 1 from public.artifact_unlink_fences as fence
        where fence.deletion_job_id = artifact_deletion_jobs.id and fence.settled_at is null
      )
    for update skip locked
  ), updated_expired as (
    update public.artifact_deletion_jobs
    set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
        available_at = case when expired.attempt_count >= expired.max_attempts then artifact_deletion_jobs.available_at else p_now end,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
        last_error_class = 'lease_expired',
        last_error_message = 'The artifact deletion worker lease expired before completion.'
    from expired
    where artifact_deletion_jobs.id = expired.id
    returning artifact_deletion_jobs.*
  )
  insert into public.audit_events (
    installation_id, event_type, actor_type, actor_id, subject_type, subject_id,
    repository_id, release_run_id, metadata, created_at
  )
  select updated_expired.installation_id,
         'artifact.object.deletion_failed',
         'system',
         p_worker_id,
         'artifact',
         updated_expired.artifact_id,
         updated_expired.repository_id,
         updated_expired.release_run_id,
         jsonb_build_object(
           'reason', updated_expired.deletion_reason,
           'storageDriver', updated_expired.storage_driver,
           'attemptCount', updated_expired.attempt_count,
           'errorClass', 'lease_expired',
           'itemType', updated_expired.artifact_kind,
           'scope', updated_expired.artifact_role
         ),
         p_now
  from updated_expired
  where updated_expired.status = 'dead_letter';

  return query
  with candidates as (
    select artifact_deletion_jobs.id
    from public.artifact_deletion_jobs
    where artifact_deletion_jobs.status = 'available'
      and artifact_deletion_jobs.available_at <= p_now
      and not exists (
        select 1 from public.artifact_unlink_fences as fence
        where fence.deletion_job_id = artifact_deletion_jobs.id and fence.settled_at is null
      )
    order by artifact_deletion_jobs.available_at, artifact_deletion_jobs.created_at, artifact_deletion_jobs.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.artifact_deletion_jobs
    set status = 'leased',
        attempt_count = artifact_deletion_jobs.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = p_lease_expires_at,
        completed_at = null,
        deletion_outcome = null,
        last_error_class = null,
        last_error_message = null
    from candidates
    where artifact_deletion_jobs.id = candidates.id
    returning artifact_deletion_jobs.*
  )
  select claimed.id,
         claimed.artifact_id,
         claimed.installation_id,
         claimed.repository_id,
         claimed.release_run_id,
         claimed.storage_driver,
         claimed.storage_path,
         claimed.deletion_reason,
         claimed.attempt_count
  from claimed
  order by claimed.available_at, claimed.created_at, claimed.id;
end;
$$;


insert into public.cloud_schema_migrations (version)
values ('0104_durable_artifact_unlink_fences')
on conflict (version) do nothing;
