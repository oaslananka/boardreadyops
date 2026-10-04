-- Add provider-neutral supplier diversity to both observation-cache scopes.
--
-- supplier_count is the count of distinct supplier companies with positive inventory in the
-- provider's configured/default market. It is normalized metadata, not raw provider offer data.

alter table component_lifecycle_observations
  add column if not exists supplier_count integer;

alter table installation_component_observations
  add column if not exists supplier_count integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_supplier_count_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_supplier_count_valid
      check (supplier_count is null or supplier_count between 0 and 100000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_supplier_count_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_supplier_count_valid
      check (supplier_count is null or supplier_count between 0 and 100000);
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0075_component_supplier_count')
on conflict (version) do nothing;
