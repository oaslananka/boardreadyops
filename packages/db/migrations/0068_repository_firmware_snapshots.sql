-- Append-only firmware dependency snapshots, scoped to a repository at a commit.
--
-- Deliberately NOT board-scoped. `captureFirmwareSnapshot` globs the whole tree and
-- FirmwareDependencyRecord carries a manifest path and no project association, so there is
-- no board fact to record. Inventing one from directory layout would put a guessed board
-- list into a CRA report with nothing marking it as guessed; see the decision on #798.
-- A configured project-to-firmware mapping will later narrow this honest superset.
--
-- Tenant scope is derived through repository -> installation; no installation_id is
-- duplicated onto these rows, matching board_bom_snapshots in 0040.

create table if not exists repository_firmware_snapshots (
  id text primary key default gen_random_uuid()::text,
  repository_id text not null references repositories(id) on delete cascade,
  run_id text not null references release_runs(id) on delete cascade,
  commit_sha text not null,
  dependency_count integer not null default 0,
  -- How many of those dependencies carry an identifier a vulnerability database indexes.
  -- Stored rather than derived so a reader can see the coverage gap without scanning rows:
  -- "no advisories found" against 1 of 40 searchable components means something different
  -- from the same sentence against 40 of 40.
  searchable_count integer not null default 0,
  captured_at timestamptz not null default now()
);

create unique index if not exists repository_firmware_snapshots_repo_run_idx
  on repository_firmware_snapshots(repository_id, run_id);

create index if not exists repository_firmware_snapshots_repo_captured_idx
  on repository_firmware_snapshots(repository_id, captured_at desc, id);

create table if not exists repository_firmware_dependencies (
  id text primary key default gen_random_uuid()::text,
  snapshot_id text not null references repository_firmware_snapshots(id) on delete cascade,
  name text not null,
  manifest_path text not null,
  origin text not null,
  version_spec text,
  pinned boolean not null default false,
  purl text,
  cpe text,
  searchable boolean not null default false,
  identity_source text
);

create index if not exists repository_firmware_dependencies_snapshot_idx
  on repository_firmware_dependencies(snapshot_id, name);

-- The two advisory lookup paths: find every snapshot carrying a component by its identifier.
create index if not exists repository_firmware_dependencies_purl_idx
  on repository_firmware_dependencies(purl)
  where purl is not null;

create index if not exists repository_firmware_dependencies_cpe_idx
  on repository_firmware_dependencies(cpe)
  where cpe is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_snapshots_counts_valid'
  ) then
    alter table repository_firmware_snapshots
      add constraint repository_firmware_snapshots_counts_valid
      check (
        dependency_count between 0 and 5000
        and searchable_count between 0 and dependency_count
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_dependencies_name_valid'
  ) then
    alter table repository_firmware_dependencies
      add constraint repository_firmware_dependencies_name_valid
      check (
        name = btrim(name)
        and char_length(name) between 1 and 256
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_dependencies_manifest_valid'
  ) then
    alter table repository_firmware_dependencies
      add constraint repository_firmware_dependencies_manifest_valid
      check (
        manifest_path = btrim(manifest_path)
        and char_length(manifest_path) between 1 and 1024
        and manifest_path not like '/%'
        and manifest_path not like '%..%'
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_dependencies_origin_valid'
  ) then
    alter table repository_firmware_dependencies
      add constraint repository_firmware_dependencies_origin_valid
      check (origin in ('registry', 'git', 'local', 'framework'));
  end if;

  -- An unsearchable dependency must not carry an identifier, and a searchable one must.
  -- The whole point of the distinction is that the two are never confusable, so the database
  -- refuses a row that claims one and shows the other.
  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_dependencies_searchable_valid'
  ) then
    alter table repository_firmware_dependencies
      add constraint repository_firmware_dependencies_searchable_valid
      check (
        (searchable and (purl is not null or cpe is not null))
        or (not searchable and purl is null and cpe is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'repository_firmware_dependencies_identifier_valid'
  ) then
    alter table repository_firmware_dependencies
      add constraint repository_firmware_dependencies_identifier_valid
      check (
        (purl is null or (purl like 'pkg:%' and char_length(purl) between 5 and 512))
        and (cpe is null or (cpe like 'cpe:2.3:%' and char_length(cpe) between 9 and 512))
      );
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0068_repository_firmware_snapshots')
on conflict (version) do nothing;
