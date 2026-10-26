-- One-use, short-lived, browser-bound OAuth intent across GitHub sign-in.
-- A nonce stored only in the browser cookie prevents cross-browser reuse.
create table if not exists remote_mcp_oauth_login_resumptions (
  id uuid primary key,
  nonce_sha256 text not null check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  client_id text not null references remote_mcp_oauth_clients(client_id),
  request_parameters jsonb not null check (jsonb_typeof(request_parameters) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index if not exists remote_mcp_oauth_login_resumptions_expiry_idx
  on remote_mcp_oauth_login_resumptions(expires_at);
