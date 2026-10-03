-- Tenant-scoped component observation cache for provider licences that permit retention but
-- forbid cross-customer reuse.
--
-- `component_lifecycle_observations` remains the shared cache for providers whose terms allow
-- cross-tenant reuse. The installation table below carries the same normalized observation
-- shape but keys every row by installation + provider + part identity, so one customer's
-- credential can never satisfy another customer's lookup.

alter table component_lifecycle_observations
  add column if not exists provider text,
  add column if not exists available_units integer,
  add column if not exists lead_time_days integer;

-- `source` is provenance returned by the normalized observation; `provider` is the cache
-- namespace selected by the resolver. Existing rows predate that distinction, so their provider
-- namespace is the source that originally wrote them.
update component_lifecycle_observations
   set provider = source
 where provider is null;

alter table component_lifecycle_observations
  alter column provider set not null;

-- Keep the original part-identity unique index in place. A later shareable provider may replace
-- a part's cached row, but provider-filtered reads will never reuse that row for the wrong
-- provider. Avoiding an index rebuild also keeps this transactional migration small and
-- non-disruptive; the migration runner intentionally wraps every migration in a transaction.

create table if not exists installation_component_observations (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  provider text not null,
  mpn text not null,
  manufacturer text,
  status text not null,
  source text not null,
  evidence_url text,
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  distributor_classification text,
  price_breaks jsonb not null default '[]'::jsonb,
  available_units integer,
  lead_time_days integer
);

create unique index if not exists installation_component_observations_part_idx
  on installation_component_observations(
    installation_id, provider, lower(mpn), lower(coalesce(manufacturer, ''))
  );

create index if not exists installation_component_observations_refresh_idx
  on installation_component_observations(installation_id, provider, expires_at)
  where expires_at is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_provider_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_provider_valid
      check (provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(provider) between 1 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_available_units_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_available_units_valid
      check (available_units is null or available_units between 0 and 2147483647);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_lead_time_days_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_lead_time_days_valid
      check (lead_time_days is null or lead_time_days between 0 and 36500);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_provider_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_provider_valid
      check (provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(provider) between 1 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_status_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_status_valid
      check (status in ('active', 'nrnd', 'eol', 'obsolete', 'unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_mpn_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_mpn_valid
      check (mpn = btrim(mpn) and char_length(mpn) between 1 and 128);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_source_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_source_valid
      check (source = btrim(source) and char_length(source) between 1 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_expiry_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_expiry_valid
      check (expires_at is null or expires_at >= observed_at);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_distributor_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_distributor_valid
      check (distributor_classification is null or distributor_classification in (
        'authorized-distributor', 'marketplace', 'unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_price_breaks_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_price_breaks_valid
      check (jsonb_typeof(price_breaks) = 'array' and pg_column_size(price_breaks) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_available_units_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_available_units_valid
      check (available_units is null or available_units between 0 and 2147483647);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_observations_lead_time_days_valid'
  ) then
    alter table installation_component_observations
      add constraint installation_component_observations_lead_time_days_valid
      check (lead_time_days is null or lead_time_days between 0 and 36500);
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0074_installation_component_observations')
on conflict (version) do nothing;
