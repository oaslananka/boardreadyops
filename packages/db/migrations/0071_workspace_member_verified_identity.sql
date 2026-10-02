-- 0071_workspace_member_verified_identity.sql
-- Pins workspace grants to a stable GitHub user id instead of a mutable/free-text login.
--
-- Existing rows predate identity verification, so github_user_id stays nullable for migration
-- compatibility. Production authorization prefers github_user_id and only falls back to user_id
-- for a legacy row until that person next signs in and can be bound to their stable id.

alter table workspace_members add column if not exists github_user_id bigint;
alter table workspace_members add column if not exists github_login text;
alter table workspace_members add column if not exists github_display_name text;
alter table workspace_members add column if not exists github_avatar_url text;

update workspace_members
   set github_login = user_id
 where github_login is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_members_github_user_id_valid'
  ) then
    alter table workspace_members
      add constraint workspace_members_github_user_id_valid
      check (github_user_id is null or github_user_id > 0);
  end if;
end;
$$;

create unique index if not exists workspace_members_github_identity_idx
  on workspace_members(workspace_id, github_user_id)
  where github_user_id is not null;

create table if not exists workspace_member_audit_events (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null,
  event_type text not null check (event_type in ('workspace_member.upsert', 'workspace_member.remove')),
  actor_github_user_id bigint not null check (actor_github_user_id > 0),
  actor_login text not null,
  subject_github_user_id bigint,
  subject_login text not null,
  previous_role text check (previous_role is null or previous_role in ('owner', 'admin', 'member', 'viewer')),
  role text check (role is null or role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now()
);

create index if not exists workspace_member_audit_events_workspace_created_idx
  on workspace_member_audit_events(workspace_id, created_at desc, id desc);

create or replace function boardreadyops_reject_workspace_member_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'workspace_member_audit_events is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists workspace_member_audit_events_append_only on workspace_member_audit_events;
create trigger workspace_member_audit_events_append_only
  before update or delete on workspace_member_audit_events
  for each row execute function boardreadyops_reject_workspace_member_audit_mutation();
