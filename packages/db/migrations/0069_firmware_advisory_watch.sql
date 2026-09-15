-- Schedule state for advisory scanning of firmware dependencies.
--
-- Keyed by repository, not by snapshot. repository_firmware_snapshots is append-only and every
-- run adds one, so a per-snapshot schedule would rescan the same dependencies once per run and
-- spend a rate-limited NVD budget learning nothing. One repository is scanned on an interval
-- against whatever its newest snapshot is, and a new snapshot makes it due immediately, because
-- new dependency data is exactly what deserves a look.
--
-- Separate from the snapshot rows deliberately: a snapshot is evidence and must not change,
-- while when it was last scanned is mutable. board_supply_watch made the same split in 0041.
--
-- Tenant scope is derived through repository -> installation; no installation_id is duplicated
-- onto these rows.

create table if not exists repository_firmware_advisory_watch (
  repository_id text primary key references repositories(id) on delete cascade,
  enabled boolean not null default true,
  next_due_at timestamptz not null default now(),
  last_scanned_at timestamptz,
  last_scanned_snapshot_id text references repository_firmware_snapshots(id) on delete set null,
  -- Must distinguish the three outcomes an advisory query can have. Collapsing "refused" or
  -- "unavailable" into "answered" is the false clean bill the whole chain exists to prevent,
  -- and persisting it here is where it would become durable.
  last_outcome text,
  consecutive_failures integer not null default 0
);

create index if not exists repository_firmware_advisory_watch_due_idx
  on repository_firmware_advisory_watch(next_due_at, repository_id)
  where enabled;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_advisory_watch_outcome_valid'
  ) then
    alter table repository_firmware_advisory_watch
      add constraint repository_firmware_advisory_watch_outcome_valid
      check (
        last_outcome is null
        or last_outcome in ('answered', 'rejected', 'unavailable', 'no_provider', 'nothing_searchable', 'failed')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_advisory_watch_failures_valid'
  ) then
    alter table repository_firmware_advisory_watch
      add constraint repository_firmware_advisory_watch_failures_valid
      check (consecutive_failures between 0 and 1000000);
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0069_firmware_advisory_watch')
on conflict (version) do nothing;
