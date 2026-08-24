-- Board identity and append-only BOM snapshots.
-- A board is discovered from run results, never configured by hand, and is
-- identified by the KiCad project path the CLI already reports per finding.
-- board_bom_snapshots is append-only: a shipped revision's component list must
-- stay readable after the design moves on, and BOM diffing needs both sides.
-- Tenant scope is derived through board -> repository -> installation; no
-- installation_id is duplicated onto these rows.

create table if not exists boards (
  id text primary key default gen_random_uuid()::text,
  repository_id text not null references repositories(id) on delete cascade,
  project_path text not null,
  display_name text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists boards_repository_project_idx
  on boards(repository_id, project_path);

create index if not exists boards_repository_active_idx
  on boards(repository_id, last_seen_at desc)
  where archived_at is null;

create table if not exists board_bom_snapshots (
  id text primary key default gen_random_uuid()::text,
  board_id text not null references boards(id) on delete cascade,
  run_id text not null references release_runs(id) on delete cascade,
  commit_sha text not null,
  component_count integer not null default 0,
  captured_at timestamptz not null default now()
);

create unique index if not exists board_bom_snapshots_board_run_idx
  on board_bom_snapshots(board_id, run_id);

create index if not exists board_bom_snapshots_board_captured_idx
  on board_bom_snapshots(board_id, captured_at desc, id);

create table if not exists board_bom_components (
  id text primary key default gen_random_uuid()::text,
  snapshot_id text not null references board_bom_snapshots(id) on delete cascade,
  reference text not null,
  mpn text,
  manufacturer text,
  value text,
  footprint text,
  quantity integer,
  dnp boolean not null default false,
  lifecycle_at_capture text,
  identity_key text
);

create index if not exists board_bom_components_snapshot_idx
  on board_bom_components(snapshot_id, reference);

create index if not exists board_bom_components_mpn_idx
  on board_bom_components(mpn)
  where mpn is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'boards_project_path_valid'
  ) then
    alter table boards
      add constraint boards_project_path_valid
      check (
        project_path = btrim(project_path)
        and char_length(project_path) between 1 and 1024
        and project_path not like '/%'
        and project_path not like '%..%'
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'boards_display_name_valid'
  ) then
    alter table boards
      add constraint boards_display_name_valid
      check (char_length(display_name) between 1 and 256);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'boards_last_seen_valid'
  ) then
    alter table boards
      add constraint boards_last_seen_valid
      check (last_seen_at >= first_seen_at);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_bom_snapshots_component_count_valid'
  ) then
    alter table board_bom_snapshots
      add constraint board_bom_snapshots_component_count_valid
      check (component_count between 0 and 5000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_bom_components_reference_valid'
  ) then
    alter table board_bom_components
      add constraint board_bom_components_reference_valid
      check (
        reference = btrim(reference)
        and char_length(reference) between 1 and 64
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_bom_components_quantity_valid'
  ) then
    alter table board_bom_components
      add constraint board_bom_components_quantity_valid
      check (quantity is null or quantity between 1 and 1000000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'board_bom_components_identity_key_valid'
  ) then
    alter table board_bom_components
      add constraint board_bom_components_identity_key_valid
      check (identity_key is null or identity_key ~ '^[0-9a-f]{16}$');
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0040_board_bom_snapshots')
on conflict (version) do nothing;
