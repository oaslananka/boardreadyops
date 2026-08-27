-- 0048_review_domain_spine.sql
-- Review and revision domain models with normalized finding fingerprint persistence.

alter table findings add column if not exists fingerprint text;
create index if not exists findings_run_fingerprint_idx on findings(run_id, fingerprint);
create index if not exists findings_fingerprint_idx on findings(fingerprint);

create table if not exists reviews (
  id text primary key default gen_random_uuid()::text,
  repository_id text not null references repositories(id) on delete cascade,
  pull_request_number integer,
  title text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'awaiting_decision', 'completed', 'superseded')),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'changes_requested')),
  base_run_id text references release_runs(id) on delete set null,
  head_run_id text not null references release_runs(id) on delete cascade,
  current_revision_id text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists reviews_repo_pr_unique_idx on reviews(repository_id, pull_request_number) where pull_request_number is not null;
create index if not exists reviews_repository_status_idx on reviews(repository_id, status);
create index if not exists reviews_head_run_idx on reviews(head_run_id);
create index if not exists reviews_updated_at_idx on reviews(repository_id, updated_at desc);

create table if not exists review_revisions (
  id text primary key default gen_random_uuid()::text,
  review_id text not null references reviews(id) on delete cascade,
  sequence integer not null,
  base_run_id text references release_runs(id) on delete set null,
  head_run_id text not null references release_runs(id) on delete cascade,
  base_commit_sha text,
  head_commit_sha text not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (review_id, sequence)
);

create index if not exists review_revisions_review_seq_idx on review_revisions(review_id, sequence desc);
create index if not exists review_revisions_head_run_idx on review_revisions(head_run_id);
