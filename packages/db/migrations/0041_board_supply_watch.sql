-- Continuous supply watch: cached component intelligence, per-board schedule state,
-- and the findings the watch raises between releases.
--
-- Tenant scope differs by table on purpose.
--   component_lifecycle_observations is NOT tenant-scoped. A part's lifecycle status is a
--   fact about the world, identical for every customer, so it is cached once and shared.
--   Whether a given provider's terms permit that shared cache is the open question in
--   ADR-0012 and must be settled before a provider is configured.
--
--   board_supply_watch and board_supply_findings ARE tenant-scoped, derived through
--   board -> repository -> installation. Cross-installation access is never permitted.

create table if not exists component_lifecycle_observations (
  id text primary key default gen_random_uuid()::text,
  mpn text not null,
  manufacturer text,
  status text not null,
  source text not null,
  evidence_url text,
  observed_at timestamptz not null default now(),
  expires_at timestamptz
);

-- One live observation per part identity. `manufacturer` is nullable, and in Postgres two
-- nulls are distinct, so the coalesce keeps a null manufacturer from inserting duplicates.
create unique index if not exists component_lifecycle_observations_part_idx
  on component_lifecycle_observations(lower(mpn), lower(coalesce(manufacturer, '')));

create index if not exists component_lifecycle_observations_refresh_idx
  on component_lifecycle_observations(expires_at)
  where expires_at is not null;

create table if not exists board_supply_watch (
  board_id text primary key references boards(id) on delete cascade,
  enabled boolean not null default true,
  next_due_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  last_outcome text,
  consecutive_failures integer not null default 0
);

create index if not exists board_supply_watch_due_idx
  on board_supply_watch(next_due_at)
  where enabled;

create table if not exists board_supply_findings (
  id text primary key default gen_random_uuid()::text,
  board_id text not null references boards(id) on delete cascade,
  mpn text not null,
  manufacturer text,
  reference text,
  status text not null,
  severity text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- One open finding per part per board; a resolved one may be superseded by a new open row.
create unique index if not exists board_supply_findings_open_idx
  on board_supply_findings(board_id, lower(mpn), lower(coalesce(manufacturer, '')))
  where resolved_at is null;

create index if not exists board_supply_findings_board_idx
  on board_supply_findings(board_id, detected_at desc, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_status_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_status_valid
      check (status in ('active', 'nrnd', 'eol', 'obsolete', 'unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_mpn_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_mpn_valid
      check (mpn = btrim(mpn) and char_length(mpn) between 1 and 128);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_source_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_source_valid
      check (char_length(source) between 1 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'component_lifecycle_observations_expiry_valid'
  ) then
    alter table component_lifecycle_observations
      add constraint component_lifecycle_observations_expiry_valid
      check (expires_at is null or expires_at >= observed_at);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_watch_failures_valid'
  ) then
    alter table board_supply_watch
      add constraint board_supply_watch_failures_valid
      check (consecutive_failures between 0 and 1000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_watch_outcome_valid'
  ) then
    alter table board_supply_watch
      add constraint board_supply_watch_outcome_valid
      check (last_outcome is null or last_outcome in ('evaluated', 'skipped_no_snapshot', 'no_provider', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_status_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_status_valid
      check (status in ('nrnd', 'eol', 'obsolete'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_severity_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_severity_valid
      check (severity in ('high', 'medium', 'critical'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_supply_findings_resolution_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_resolution_valid
      check (resolved_at is null or resolved_at >= detected_at);
  end if;
end;
$$;

-- Every existing board becomes watched, due immediately, so enabling the feature does not
-- require a backfill pass over historical runs.
insert into board_supply_watch (board_id)
select boards.id from boards
on conflict (board_id) do nothing;

insert into cloud_schema_migrations (version)
values ('0041_board_supply_watch')
on conflict (version) do nothing;
