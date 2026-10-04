-- Time-bound suppression for one durable supply finding.
--
-- Suppression is deliberately separate from acknowledgement and resolution:
-- - acknowledgement says a human saw the finding;
-- - suppression temporarily removes it from repeated alert/policy attention;
-- - resolution says the underlying observed risk is no longer present.
--
-- Rows are historical. Clearing or expiry never deletes the suppression record, and a future
-- re-opened finding has a new finding id so an old suppression can never hide a new transition.

create table if not exists supply_finding_suppressions (
  id text primary key default gen_random_uuid()::text,
  finding_id text not null references board_supply_findings(id) on delete cascade,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cleared_at timestamptz,
  cleared_by text,
  constraint supply_finding_suppressions_reason_valid
    check (reason = btrim(reason) and char_length(reason) between 3 and 500),
  constraint supply_finding_suppressions_creator_valid
    check (created_by = btrim(created_by) and char_length(created_by) between 1 and 128),
  constraint supply_finding_suppressions_expiry_valid
    check (expires_at > created_at),
  constraint supply_finding_suppressions_clear_pair_valid
    check (
      (cleared_at is null and cleared_by is null)
      or (
        cleared_at is not null
        and cleared_by is not null
        and cleared_by = btrim(cleared_by)
        and char_length(cleared_by) between 1 and 128
        and cleared_at >= created_at
      )
    )
);

-- At most one uncleared row exists at a time. Expired rows are closed by the next suppress
-- operation before a replacement is inserted, preserving both concurrency safety and history.
create unique index if not exists supply_finding_suppressions_current_idx
  on supply_finding_suppressions(finding_id)
  where cleared_at is null;

create index if not exists supply_finding_suppressions_history_idx
  on supply_finding_suppressions(finding_id, created_at desc, id);

insert into cloud_schema_migrations (version)
values ('0078_supply_finding_suppressions')
on conflict (version) do nothing;
