-- #1248: explicitly pre-registered OAuth clients and short-lived, one-use codes.
-- No clients are created by this migration. All OAuth HTTP routes remain disabled.
-- Client ID Metadata Documents (CIMD) require separate SSRF review before activation.
create table if not exists remote_mcp_oauth_clients (
  client_id text primary key check (length(client_id) between 1 and 2048),
  redirect_uri text not null check (length(redirect_uri) between 12 and 2048),
  display_name text not null check (length(display_name) between 1 and 128),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists remote_mcp_oauth_authorizations (
  id text primary key check (length(id) between 16 and 128),
  github_user_id bigint not null check (github_user_id > 0),
  client_id text not null references remote_mcp_oauth_clients(client_id),
  redirect_uri text not null,
  scope text not null check (scope in ('review:read', 'evidence:read', 'review:read evidence:read', 'evidence:read review:read')),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  csrf_sha256 text not null check (csrf_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (length(state) between 8 and 512),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  approved_at timestamptz,
  denied_at timestamptz,
  code_sha256 text unique check (code_sha256 is null or code_sha256 ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz,
  redeemed_at timestamptz,
  check (not (approved_at is not null and denied_at is not null)),
  check ((code_sha256 is null and code_expires_at is null) or (code_sha256 is not null and code_expires_at is not null and approved_at is not null))
);
create index if not exists remote_mcp_oauth_authorizations_pending_idx
  on remote_mcp_oauth_authorizations (github_user_id, expires_at)
  where approved_at is null and denied_at is null;
