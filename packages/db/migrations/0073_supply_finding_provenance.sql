-- Preserve the minimal provenance that justified a tenant-scoped supply finding.
--
-- The shared component observation row remains a bounded latest-value cache governed by the
-- provider's cache policy. Findings are different: they are durable customer decision records.
-- Store only the provider identifier that produced the lifecycle decision; do not copy provider
-- payloads, evidence URLs, pricing, inventory, or other cached content into the finding history.
-- `detected_at` is already the BoardReadyOps evaluation time, so together these fields answer
-- which source caused the alert and when BoardReadyOps acted on it.

alter table board_supply_findings
  add column if not exists observation_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_observation_source_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_observation_source_valid
      check (
        observation_source is null
        or (observation_source = btrim(observation_source) and char_length(observation_source) between 1 and 64)
      );
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0073_supply_finding_provenance')
on conflict (version) do nothing;
