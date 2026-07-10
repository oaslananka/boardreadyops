-- Release run lifecycle hardening.
-- Supports idempotent duplicate handling and superseding stale active runs.

create index if not exists release_runs_active_pr_idx
  on release_runs(repository_id, pull_request_number, started_at)
  where status in ('queued', 'dispatched', 'running');
