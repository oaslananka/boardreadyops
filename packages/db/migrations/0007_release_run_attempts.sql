-- Separate execution-attempt history from the logical release run.
-- release_runs.execution_attempt_id remains the pointer to the currently assigned attempt.

create table if not exists release_run_attempts (
  id text primary key,
  run_id text not null references release_runs(id) on delete cascade,
  attempt_number integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  dispatch_requested_at timestamptz,
  dispatched_at timestamptz,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  retry_after_at timestamptz,
  github_workflow_dispatch_id text,
  failure_class text,
  failure_message text,
  result_digest text,
  constraint release_run_attempts_number_valid check (attempt_number > 0),
  constraint release_run_attempts_status_valid check (
    status in (
      'queued',
      'dispatching',
      'dispatched',
      'in_progress',
      'uploading_artifacts',
      'reporting',
      'completed',
      'failed',
      'cancelled',
      'timed_out',
      'stale',
      'superseded'
    )
  ),
  constraint release_run_attempts_failure_class_valid
    check (failure_class is null or char_length(failure_class) between 1 and 128),
  constraint release_run_attempts_failure_message_valid
    check (failure_message is null or char_length(failure_message) <= 4000),
  constraint release_run_attempts_result_digest_valid
    check (result_digest is null or result_digest ~ '^[0-9a-f]{64}$'),
  constraint release_run_attempts_completion_valid check (
    (status in ('completed', 'failed', 'cancelled', 'timed_out', 'stale', 'superseded')) = (completed_at is not null)
  )
);

create unique index if not exists release_run_attempts_run_number_idx
  on release_run_attempts(run_id, attempt_number);

create index if not exists release_run_attempts_run_created_idx
  on release_run_attempts(run_id, created_at desc, attempt_number desc);

create index if not exists release_run_attempts_active_idx
  on release_run_attempts(status, dispatch_requested_at, heartbeat_at)
  where status in ('queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting');

insert into release_run_attempts (
  id,
  run_id,
  attempt_number,
  status,
  created_at,
  dispatch_requested_at,
  dispatched_at,
  started_at,
  heartbeat_at,
  completed_at,
  result_digest
)
select
  release_runs.execution_attempt_id,
  release_runs.id,
  1,
  case release_runs.status
    when 'queued' then 'dispatching'
    when 'dispatched' then 'dispatched'
    when 'running' then 'in_progress'
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    when 'timed_out' then 'timed_out'
    when 'superseded' then 'superseded'
    else 'stale'
  end,
  coalesce(release_runs.execution_attempt_started_at, release_runs.started_at),
  coalesce(release_runs.execution_attempt_started_at, release_runs.started_at),
  case
    when release_runs.status in ('dispatched', 'running', 'completed', 'failed', 'timed_out', 'superseded')
      then coalesce(release_runs.execution_attempt_started_at, release_runs.started_at)
  end,
  case
    when release_runs.status in ('running', 'completed', 'failed', 'timed_out')
      then coalesce(release_runs.execution_attempt_started_at, release_runs.started_at)
  end,
  case
    when release_runs.status in ('running', 'completed', 'failed', 'timed_out')
      then coalesce(release_runs.completed_at, release_runs.execution_attempt_started_at, release_runs.started_at)
  end,
  case
    when release_runs.status in ('completed', 'failed', 'timed_out', 'superseded')
      then coalesce(release_runs.completed_at, release_runs.execution_attempt_started_at, release_runs.started_at)
  end,
  release_runs.terminal_result_digest
from release_runs
where release_runs.execution_attempt_id is not null
on conflict (id) do nothing;
