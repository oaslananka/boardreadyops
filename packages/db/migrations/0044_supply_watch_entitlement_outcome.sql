-- Record when a board's watch was skipped because the plan does not include supply watch.
--
-- Supply watch is a paid capability: planLimits(free).supplyWatch is false. Until now the
-- outcome vocabulary had no way to say so, and the alternatives all lie. Reporting 'evaluated'
-- would claim a board was checked when nothing looked at it; 'failed' would suggest a defect
-- to fix; 'no_provider' would blame missing credentials for what is really a plan boundary.
--
-- A board on an unentitled plan stays enrolled and keeps accumulating BOM evidence, so raising
-- the plan starts watching it without any backfill. The distinct outcome is what makes that
-- state legible -- to an operator reading the table, and to a customer asking why a board shows
-- no findings.

alter table board_supply_watch
  drop constraint if exists board_supply_watch_outcome_valid;

alter table board_supply_watch
  add constraint board_supply_watch_outcome_valid
  check (
    last_outcome is null
    or last_outcome in ('evaluated', 'skipped_no_snapshot', 'no_provider', 'not_entitled', 'failed')
  );

insert into cloud_schema_migrations (version)
values ('0044_supply_watch_entitlement_outcome')
on conflict (version) do nothing;
