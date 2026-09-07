-- 0064_workspace_membership_authorization.sql
-- Gives the workspace/project/revision/delivery tree an owner, so it can be authorized.
--
-- 0063 tried to create `workspace_memberships` with a (workspace_id, user_id) shape, but
-- 0052_billing.sql had already created a table of that name for seat billing, keyed by an
-- opaque `tenant_id`. `create table if not exists` therefore did nothing and reported success:
-- every database carries 0052's shape, 0063's definition is inert, and no row anywhere records
-- who owns a workspace.
--
-- Nothing could authorize against a table that was never populated, so the v2 routes did not
-- try: any authenticated caller could read and write any workspace. This table is what they
-- authorize against. It is named `workspace_members` because 0052 owns the other name and its
-- billing meaning; renaming an applied table would break that.

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members(user_id);
