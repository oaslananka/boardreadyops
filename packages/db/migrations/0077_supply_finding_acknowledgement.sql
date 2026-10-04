-- Record that an operator has seen an open supply finding without resolving or suppressing it.
--
-- Acknowledgement belongs to the finding row, not the part identity. If the risk resolves and
-- later re-opens, the new finding starts unacknowledged so a stale acknowledgement cannot hide a
-- new lifecycle/availability transition.

alter table board_supply_findings
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'board_supply_findings_acknowledgement_pair_valid'
  ) then
    alter table board_supply_findings
      add constraint board_supply_findings_acknowledgement_pair_valid
      check (
        (acknowledged_at is null and acknowledged_by is null)
        or (
          acknowledged_at is not null
          and acknowledged_by is not null
          and acknowledged_by = btrim(acknowledged_by)
          and char_length(acknowledged_by) between 1 and 128
        )
      );
  end if;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0077_supply_finding_acknowledgement')
on conflict (version) do nothing;
