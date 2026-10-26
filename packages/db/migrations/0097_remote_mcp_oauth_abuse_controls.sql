-- Durable OAuth abuse controls shared by web replicas. No plaintext IP, bearer,
-- PKCE verifier, authorization code, browser cookie or state is persisted.
create table if not exists remote_mcp_oauth_rate_limits (
  bucket_sha256 text primary key check (bucket_sha256 ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);
create index if not exists remote_mcp_oauth_rate_limits_expiry_idx
  on remote_mcp_oauth_rate_limits(window_started_at);

create table if not exists remote_mcp_oauth_security_events (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  event_kind text not null check (event_kind in
    ('consent_started', 'consent_approved', 'consent_denied', 'token_issued',
     'token_rejected', 'rate_limited', 'grant_revoked')),
  github_user_id bigint check (github_user_id is null or github_user_id > 0),
  client_sha256 text check (client_sha256 is null or client_sha256 ~ '^[a-f0-9]{64}$'),
  grant_id text check (grant_id is null or length(grant_id) between 16 and 128)
);
create index if not exists remote_mcp_oauth_security_events_time_idx
  on remote_mcp_oauth_security_events(recorded_at);
