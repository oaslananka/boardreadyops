/* tsqllint-disable set-quoted-identifier */
-- PostgreSQL-only. Human sharing consent is distinct from passing DFM tests.
-- An authorization binds a verified workspace owner/admin to one immutable
-- source/run/artifact/digest tuple; nothing is implicitly approved on migration.
create table if not exists manufacturing_share_authorizations (
  revision_id text primary key references revisions(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  run_id text references release_runs(id) on delete set null,
  artifact_id text references artifacts(id) on delete set null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  archive_sha256 text not null check (archive_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_by_github_user_id bigint not null check (authorized_by_github_user_id > 0),
  authorized_by_login text not null,
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_github_user_id bigint check (revoked_by_github_user_id is null or revoked_by_github_user_id > 0),
  revoked_by_login text,
  check (revoked_at is null or revoked_at >= authorized_at),
  check ((revoked_at is null) = (revoked_by_github_user_id is null)),
  check ((revoked_at is null) = (revoked_by_login is null))
);
create index if not exists manufacturing_share_authorizations_workspace_idx
  on manufacturing_share_authorizations(workspace_id, authorized_at desc);
-- A revoked consent is not reusable. A fresh consent is a new explicit decision
-- (a revision must be re-registered rather than silently reactivated).
