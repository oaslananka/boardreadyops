/* tsqllint-disable set-quoted-identifier */
-- Optional, disclosure-minimal PCB-footprint counts provided by an authenticated
-- client. Immutable run evidence, not independently verified source or a verdict.
-- Existing runs/reviews remain unaffected. Cascades with their owning run/repo.
create table if not exists run_pcb_footprint_summaries (
  run_id text primary key references release_runs(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  base_commit_sha text not null check (base_commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  head_commit_sha text not null check (head_commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  summary_sha256 text not null check (summary_sha256 ~ '^[0-9a-f]{64}$'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists run_pcb_footprint_summaries_repository_idx
  on run_pcb_footprint_summaries(repository_id, created_at desc);
