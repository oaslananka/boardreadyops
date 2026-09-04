-- Distributor classification and quantity-price tier snapshot metadata on cached component
-- observations. Both come from the same provider lookup that already populates lifecycle
-- status (component_lifecycle_observations, added in 0041_board_supply_watch.sql), so they are
-- added to that row rather than a new table: one snapshot per part identity, matching the
-- existing "one live observation per part" unique index.

alter table component_lifecycle_observations
  add column if not exists distributor_classification text,
  add column if not exists price_breaks jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_distributor_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_distributor_valid
      check (distributor_classification is null or distributor_classification in (
        'authorized-distributor', 'marketplace', 'unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_price_breaks_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_price_breaks_valid
      check (jsonb_typeof(price_breaks) = 'array' and pg_column_size(price_breaks) <= 16384);
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0059_component_pricing_snapshot')
on conflict (version) do nothing;
