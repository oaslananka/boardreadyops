-- Versioned runner-result payloads and publication state.
-- The raw normalized payload is retained so dashboard, audit, and replay behavior
-- all derive from the same accepted result.

create table if not exists release_run_results (
  run_id text primary key references release_runs(id) on delete cascade,
  execution_attempt_id text,
  contract_version integer not null,
  status text not null,
  conclusion text not null,
  decision text,
  metrics jsonb not null default '{}'::jsonb,
  report_links jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  result_digest text not null,
  received_at timestamptz not null default now(),
  last_publication_attempt_at timestamptz,
  github_check_published_at timestamptz,
  github_comment_published_at timestamptz,
  last_publication_error text,
  constraint release_run_results_execution_attempt_id_valid
    check (
      execution_attempt_id is null
      or execution_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  constraint release_run_results_contract_version_valid check (contract_version > 0),
  constraint release_run_results_status_valid check (status in ('queued', 'running', 'completed', 'timed_out', 'failed')),
  constraint release_run_results_conclusion_valid check (conclusion in ('success', 'failure', 'neutral', 'timed_out')),
  constraint release_run_results_decision_valid check (decision is null or decision in ('pass', 'fail', 'error')),
  constraint release_run_results_metrics_valid
    check (jsonb_typeof(metrics) = 'object' and pg_column_size(metrics) <= 65536),
  constraint release_run_results_report_links_valid
    check (jsonb_typeof(report_links) = 'array' and pg_column_size(report_links) <= 65536),
  constraint release_run_results_payload_valid
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2097152),
  constraint release_run_results_digest_valid check (result_digest ~ '^[0-9a-f]{64}$'),
  constraint release_run_results_publication_error_valid
    check (last_publication_error is null or char_length(last_publication_error) <= 4000)
);

create unique index if not exists release_run_results_execution_attempt_id_idx
  on release_run_results(execution_attempt_id)
  where execution_attempt_id is not null;

create index if not exists release_run_results_received_at_idx
  on release_run_results(received_at desc, run_id desc);

-- Audit rows remain immutable to direct callers, while lifecycle-owned parent
-- deletion may still honor the schema's explicit ON DELETE CASCADE contract.
create or replace function boardreadyops_reject_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception 'audit_events is append-only'
    using errcode = '55000';
end;
$$;
