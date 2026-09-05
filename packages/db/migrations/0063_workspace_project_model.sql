-- 0063_workspace_project_model.sql
-- Standalone Workspace, Project, Revision, and Delivery models for multi-CAD and standalone operations.

create table if not exists workspaces (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text unique not null,
  plan_tier text not null default 'community' check (plan_tier in ('community', 'team', 'business', 'pilot')),
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create index if not exists workspaces_slug_idx on workspaces(slug);

create table if not exists workspace_memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_memberships_user_idx on workspace_memberships(user_id);

create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  default_cad_format text not null default 'kicad',
  github_repo_full_name text,
  created_at timestamptz not null default now()
);

create index if not exists projects_workspace_idx on projects(workspace_id);
create index if not exists projects_github_repo_idx on projects(github_repo_full_name);

create table if not exists revisions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  revision_label text not null,
  source_kind text not null default 'direct_upload' check (source_kind in ('direct_upload', 'github_commit', 'native_export')),
  commit_sha text,
  bundle_sha256 text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists revisions_project_idx on revisions(project_id, created_at desc);
create index if not exists revisions_bundle_sha256_idx on revisions(bundle_sha256);

create table if not exists deliveries (
  id text primary key default gen_random_uuid()::text,
  revision_id text not null references revisions(id) on delete cascade,
  access_token_hash text not null,
  expires_at timestamptz not null,
  signed_archive_url text not null,
  recipient_notes text,
  created_at timestamptz not null default now()
);

create index if not exists deliveries_revision_idx on deliveries(revision_id);
create index if not exists deliveries_token_hash_idx on deliveries(access_token_hash);
