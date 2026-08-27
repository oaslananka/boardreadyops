-- 0049_api_tokens.sql
-- Scoped workspace API tokens for CLI and CI/CD automation.

create table if not exists api_tokens (
  id text primary key default gen_random_uuid()::text,
  repository_id text not null references repositories(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default array['runs:write', 'reviews:read', 'reviews:write'],
  created_by text not null default 'system',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_tokens_repo_idx on api_tokens(repository_id);
create index if not exists api_tokens_hash_idx on api_tokens(token_hash) where revoked_at is null;
