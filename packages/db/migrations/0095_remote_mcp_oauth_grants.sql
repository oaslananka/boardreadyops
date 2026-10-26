-- OAuth resource access grants are user- and client-bound, revocable, time-limited,
-- and scoped to the canonical remote MCP audience. Never store raw bearer tokens.
-- No production grants are issued by this migration; /mcp remains disabled.
create table if not exists remote_mcp_oauth_grants (
  jti text primary key check (length(jti) between 16 and 128),
  github_user_id bigint not null check (github_user_id > 0),
  client_id text not null check (length(client_id) between 1 and 2048),
  issuer text not null check (length(issuer) between 8 and 2048),
  audience text not null default 'https://boardreadyops.com/mcp'
    check (audience = 'https://boardreadyops.com/mcp'),
  scope text not null check (scope in ('review:read', 'evidence:read', 'review:read evidence:read', 'evidence:read review:read')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,
  check (expires_at <= created_at + interval '1 hour')
);
create index if not exists remote_mcp_oauth_grants_active_user_idx
  on remote_mcp_oauth_grants(github_user_id, expires_at)
  where revoked_at is null;
