-- Review-canvas snapshots (rendered schematic/PCB SVG + finding anchors) for a release run.
-- Content is inline SVG text produced locally by src/kicad/snapshots.ts::generateSnapshots and
-- published via `boardreadyops review publish` alongside findings -- never the source KiCad
-- files -- so it rides its own table rather than the binary artifacts/storage_path pipeline.

create table if not exists run_snapshots (
  id text primary key default gen_random_uuid()::text,
  run_id text not null references release_runs(id) on delete cascade,
  snapshot_id text not null,
  name text not null,
  kind text not null,
  format text not null,
  sheet_or_layer text not null,
  width integer not null,
  height integer not null,
  content text not null,
  sha256 text not null,
  anchors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'run_snapshots_kind_valid'
  ) then
    alter table run_snapshots
      add constraint run_snapshots_kind_valid
      check (kind in ('schematic', 'pcb_layer', '3d_render'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'run_snapshots_format_valid'
  ) then
    alter table run_snapshots
      add constraint run_snapshots_format_valid
      check (format in ('svg', 'png', 'webp'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'run_snapshots_sha256_valid'
  ) then
    alter table run_snapshots
      add constraint run_snapshots_sha256_valid
      check (sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'run_snapshots_anchors_valid'
  ) then
    alter table run_snapshots
      add constraint run_snapshots_anchors_valid
      check (jsonb_typeof(anchors) = 'array' and pg_column_size(anchors) <= 65536);
  end if;
end;
$$;

create index if not exists run_snapshots_run_id_idx
  on run_snapshots(run_id, created_at, id);
