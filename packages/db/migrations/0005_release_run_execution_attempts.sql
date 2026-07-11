-- Bind callbacks to the exact workflow execution attempt that produced them.
-- The digest distinguishes safe terminal replays from conflicting terminal results.

alter table release_runs
  add column if not exists execution_attempt_id text,
  add column if not exists execution_attempt_started_at timestamptz,
  add column if not exists terminal_result_digest text;

do $$
begin
  alter table release_runs
    add constraint release_runs_execution_attempt_id_valid
    check (
      execution_attempt_id is null
      or execution_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table release_runs
    add constraint release_runs_execution_attempt_timestamp_valid
    check ((execution_attempt_id is null) = (execution_attempt_started_at is null));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table release_runs
    add constraint release_runs_terminal_result_digest_valid
    check (terminal_result_digest is null or terminal_result_digest ~ '^[0-9a-f]{64}$');
exception
  when duplicate_object then null;
end
$$;

create unique index if not exists release_runs_execution_attempt_id_idx
  on release_runs(execution_attempt_id);
