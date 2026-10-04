-- Extend the one-open-finding-per-part supply-risk vocabulary with explicit zero-stock risk.
--
-- Lifecycle risk remains higher priority in the evaluator. "unavailable" is used only when the
-- provider reports exactly zero available units and the lifecycle state is not already NRND/EOL/
-- obsolete.

alter table board_supply_findings
  drop constraint if exists board_supply_findings_status_valid;

alter table board_supply_findings
  add constraint board_supply_findings_status_valid
  check (status in ('nrnd', 'eol', 'obsolete', 'unavailable'));

insert into cloud_schema_migrations (version)
values ('0076_supply_unavailable_findings')
on conflict (version) do nothing;
