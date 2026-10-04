-- Persist a bounded provider-neutral alternate-part summary with component observations.
--
-- This is intentionally a small decision-support cache, not a component-search index. Provider
-- adapters cap the list before it reaches this table, and the database caps the serialized shape
-- so one provider response cannot grow an observation row without bound.

alter table component_lifecycle_observations
  add column if not exists alternates jsonb not null default '[]'::jsonb;

alter table installation_component_observations
  add column if not exists alternates jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_alternates_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_alternates_valid
      check (jsonb_typeof(alternates) = 'array' and pg_column_size(alternates) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_alternates_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_alternates_valid
      check (jsonb_typeof(alternates) = 'array' and pg_column_size(alternates) <= 16384);
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0079_component_alternates')
on conflict (version) do nothing;
