-- Prevent v2 verified-owner candidate evidence being silently downgraded into
-- the historical v1 non-executable seal, whose snapshot digest omits owner ID.
-- This does NOT authorize dispatch, runner leases or callback acceptance.
-- Existing v1 candidate -> v1 seal behavior remains supported.
alter table protected_release_execution_seals
  add column if not exists github_owner_id bigint;

alter table protected_release_execution_seals
  drop constraint if exists protected_release_seals_version_valid,
  add constraint protected_release_seals_version_valid check (
    (snapshot_version = 1 and github_owner_id is null)
    or (snapshot_version = 2 and github_owner_id > 0)
  );

create or replace function boardreadyops_enforce_protected_release_seal_version()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_version integer;
  v_owner_id bigint;
begin
  select evidence_version, github_owner_id
    into v_version, v_owner_id
    from public.protected_release_intent_candidates
   where id = new.candidate_id
   for share;

  if v_version is null
     or new.snapshot_version is distinct from v_version
     or new.github_owner_id is distinct from v_owner_id then
    raise exception 'protected release seal evidence version or owner identity mismatch'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists protected_release_seals_evidence_version_guard
  on protected_release_execution_seals;
create trigger protected_release_seals_evidence_version_guard
  before insert on protected_release_execution_seals
  for each row execute function boardreadyops_enforce_protected_release_seal_version();

insert into cloud_schema_migrations (version)
values ('0091_protected_release_seal_evidence_version_guard')
on conflict (version) do nothing;
