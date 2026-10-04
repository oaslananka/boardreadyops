-- Normalize bounded compliance/trust signals into component observations and durable supply findings.
--
-- These columns hold only provider-normalized decision data. Do not store raw provider payloads,
-- documents, authorization data, or unbounded regulatory text here.

alter table component_lifecycle_observations
  add column if not exists restricted_substances boolean,
  add column if not exists compliance_notes jsonb not null default '[]'::jsonb,
  add column if not exists data_trust text;

alter table installation_component_observations
  add column if not exists restricted_substances boolean,
  add column if not exists compliance_notes jsonb not null default '[]'::jsonb,
  add column if not exists data_trust text;

alter table board_supply_findings
  add column if not exists restricted_substances boolean,
  add column if not exists compliance_notes jsonb not null default '[]'::jsonb,
  add column if not exists observation_trust text;

alter table board_supply_findings
  drop constraint if exists board_supply_findings_status_valid;

alter table board_supply_findings
  add constraint board_supply_findings_status_valid
  check (status in ('nrnd', 'eol', 'obsolete', 'unavailable', 'restricted'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_compliance_notes_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_compliance_notes_valid
      check (jsonb_typeof(compliance_notes) = 'array' and pg_column_size(compliance_notes) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_compliance_notes_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_compliance_notes_valid
      check (jsonb_typeof(compliance_notes) = 'array' and pg_column_size(compliance_notes) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_compliance_notes_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_compliance_notes_valid
      check (jsonb_typeof(compliance_notes) = 'array' and pg_column_size(compliance_notes) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_data_trust_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_data_trust_valid
      check (data_trust is null or data_trust in ('verified', 'estimated', 'unverified', 'unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_data_trust_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_data_trust_valid
      check (data_trust is null or data_trust in ('verified', 'estimated', 'unverified', 'unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_observation_trust_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_observation_trust_valid
      check (observation_trust is null or observation_trust in ('verified', 'estimated', 'unverified', 'unknown'));
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0080_component_compliance_trust')
on conflict (version) do nothing;
