-- Capture the configured project release mode alongside each immutable BOM snapshot.
--
-- Release mode is existing BoardReadyOps product criticality context (prototype/pilot/production).
-- It belongs on the snapshot rather than the mutable board row because teams may promote a
-- project between modes over time, and historical supply impact must explain the context that
-- applied to the affected release.

alter table board_bom_snapshots
  add column if not exists release_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'board_bom_snapshots_release_mode_valid'
  ) then
    alter table board_bom_snapshots
      add constraint board_bom_snapshots_release_mode_valid
      check (release_mode is null or release_mode in ('prototype', 'pilot', 'production'));
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0081_board_snapshot_release_mode')
on conflict (version) do nothing;
