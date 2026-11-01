-- A committed export-copy reservation must cover the entire physical read.
-- Unresolved reservations are quarantine state: NEVER expire or clear on a timer.
-- This does not authorize customer delivery, restart expired export claims, or
-- bypass legal holds. Deployment still requires all old unlink workers quiesced.
create table if not exists artifact_export_copy_reservations (
  token uuid primary key,
  export_id text not null,
  artifact_id text not null,
  tenant_key text not null check (tenant_key = lower(tenant_key) and char_length(tenant_key) between 1 and 256),
  storage_path text not null check (char_length(storage_path) between 1 and 1024),
  worker_id text not null,
  started_at timestamptz not null default clock_timestamp(),
  released_at timestamptz
);
create unique index if not exists artifact_export_copy_active_claim_idx
  on public.artifact_export_copy_reservations(export_id, artifact_id) where released_at is null;
create index if not exists artifact_export_copy_active_path_idx
  on public.artifact_export_copy_reservations(storage_path) where released_at is null;

-- Shared path locks serialize physical unlink and export-copy admission, even
-- across distinct tenants referencing the same physical storage locator.
create or replace function boardreadyops_artifact_path_lock_key(p_path text)
returns bigint language sql immutable strict parallel safe
set search_path = pg_catalog, public
as $$ select hashtextextended('boardreadyops/artifact-path/v1:' || p_path, 0) $$;

create or replace function boardreadyops_begin_export_object_copy(
  p_export_id text, p_tenant_id text, p_installation_id text,
  p_worker_id text, p_worker_token text, p_artifact_id text,
  p_expected_path text, p_reservation uuid
) returns text language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_tenant text;
  v_path text;
  v_current text;
  v_current_path text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'export copy admission requires read committed isolation' using errcode='B4402';
  end if;
  -- This first lookup is only a lock-key hint. The authoritative authorization
  -- is repeated under both transaction locks; a revoked claim cannot race in.
  select lower(i.account_login), a.storage_path into v_tenant, v_path
    from public.data_exports as e
    join public.installations as i on i.id=e.installation_id
    join public.artifacts as a on a.id=p_artifact_id
    join public.release_runs as run on run.id=a.run_id
    join public.repositories as repo on repo.id=run.repository_id
   where e.id=p_export_id and lower(e.tenant_id)=lower(p_tenant_id)
     and e.installation_id=p_installation_id
     and e.status='running' and e.preparation_worker=p_worker_id
     and e.preparation_token=p_worker_token and e.preparation_lease_until > clock_timestamp()
     and i.suspended_at is null and lower(i.account_login)=lower(e.tenant_id)
     and repo.installation_id=i.id and repo.disabled_at is null
     and ((e.scope='organization' and e.scope_id is null)
       or (e.scope='repository' and e.scope_id=repo.id))
     and a.retention_until is not null and a.retention_until > clock_timestamp();
  if v_tenant is null or v_path is distinct from p_expected_path
     or v_path is null or char_length(v_path) not between 1 and 1024
    then return 'stale'; end if;
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_tenant));
  perform pg_advisory_xact_lock(boardreadyops_artifact_path_lock_key(v_path));
  -- Current authority AND unchanged key must be verified after lock admission.
  select lower(i.account_login), a.storage_path into v_current, v_current_path
    from public.data_exports as e
    join public.installations as i on i.id=e.installation_id
    join public.artifacts as a on a.id=p_artifact_id
    join public.release_runs as run on run.id=a.run_id
    join public.repositories as repo on repo.id=run.repository_id
   where e.id=p_export_id and lower(e.tenant_id)=lower(p_tenant_id)
     and e.installation_id=p_installation_id
     and e.status='running' and e.preparation_worker=p_worker_id
     and e.preparation_token=p_worker_token and e.preparation_lease_until > clock_timestamp()
     and i.suspended_at is null and lower(i.account_login)=lower(e.tenant_id)
     and repo.installation_id=i.id and repo.disabled_at is null
     and ((e.scope='organization' and e.scope_id is null)
       or (e.scope='repository' and e.scope_id=repo.id))
     and a.retention_until is not null and a.retention_until > clock_timestamp();
  if v_current is distinct from v_tenant or v_current_path is distinct from v_path
    then return 'stale'; end if;
  if exists (
    select 1 from public.artifact_deletion_jobs as job
    where job.storage_path=v_path
  ) then return 'stale'; end if;
  if exists (
    select 1 from public.artifact_unlink_fences as f
    join public.artifact_deletion_jobs as job on job.id=f.deletion_job_id
    where f.settled_at is null and job.storage_path=v_path
  ) then return 'stale'; end if;
  if exists (
    select 1 from public.artifact_export_copy_reservations as r
    where r.export_id=p_export_id and r.artifact_id=p_artifact_id and r.released_at is null
  ) then return 'stale'; end if;
  insert into public.artifact_export_copy_reservations
    (token,export_id,artifact_id,tenant_key,storage_path,worker_id)
  values (p_reservation,p_export_id,p_artifact_id,v_tenant,v_path,p_worker_id);
  return 'reserved';
end;
$$;

create or replace function boardreadyops_finish_export_object_copy(
  p_export_id text, p_worker_id text, p_reservation uuid
) returns text language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Caller must wait for the physical read Promise to settle before calling.
  -- An ambiguous DB outcome leaves an unresolved reservation, never assumed
  -- successfully cleared. The original worker ID and random UUID are required.
  update public.artifact_export_copy_reservations
     set released_at=clock_timestamp()
   where token=p_reservation and export_id=p_export_id and worker_id=p_worker_id
     and released_at is null;
  if found then return 'released'; end if;
  return 'stale';
end;
$$;

-- Replace existing unlink-admission function additively: keep its legal hold and
-- lease behavior, but insert the SAME path lock and durable export reservation
-- check before any physical unlink fence is issued.
create or replace function boardreadyops_begin_artifact_unlink(
  p_job_id text, p_worker_id text, p_token uuid
) returns text language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_tenant text;
  v_current text;
  v_path text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unlink admission requires read committed isolation' using errcode='B4402';
  end if;
  select lower(i.account_login) into v_tenant
    from public.artifact_deletion_jobs as j
    join public.installations as i on i.id=j.installation_id
   where j.id=p_job_id;
  if v_tenant is null then return 'stale'; end if;
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(boardreadyops_hold_unlink_lock_key(v_tenant));
  select lower(i.account_login), j.storage_path into v_current, v_path
    from public.artifact_deletion_jobs as j
    join public.installations as i on i.id=j.installation_id
   where j.id=p_job_id and j.status='leased'
     and j.lease_owner=p_worker_id and j.lease_expires_at>clock_timestamp()
     and j.storage_driver='local'
   for update of j;
  if v_current is null or v_current<>v_tenant then return 'stale'; end if;
  perform pg_advisory_xact_lock(boardreadyops_artifact_path_lock_key(v_path));
  if exists (select 1 from public.artifact_unlink_fences
             where deletion_job_id=p_job_id and settled_at is null)
    then return 'stale'; end if;
  if exists (select 1 from public.legal_holds
             where lower(tenant_id)=v_tenant and active=true)
     or exists (select 1 from public.artifact_export_copy_reservations
                where storage_path=v_path and released_at is null)
  then
    update public.artifact_deletion_jobs
       set status='available',
           available_at=clock_timestamp()+interval '30 minutes',
           lease_owner=null, lease_expires_at=null,
           attempt_count=greatest(0,attempt_count-1),
           last_error_class=case when exists (
             select 1 from public.legal_holds
              where lower(tenant_id)=v_tenant and active=true
           ) then 'legal_hold' else 'export_copy_in_progress' end,
           last_error_message='Physical deletion deferred by active protection.'
     where id=p_job_id;
    return 'held';
  end if;
  insert into public.artifact_unlink_fences(token,deletion_job_id,tenant_key,worker_id)
  values (p_token,p_job_id,v_tenant,p_worker_id);
  return 'authorized';
end;
$$;

insert into public.cloud_schema_migrations(version)
values ('0110_artifact_export_copy_unlink_fence')
on conflict(version) do nothing;
