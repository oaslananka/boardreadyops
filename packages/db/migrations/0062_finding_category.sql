-- The rule's registered domain (src/core/rule-registry.ts's RuleCategory), so the run/review UI
-- can group findings into per-domain readiness score cards without needing the CLI's rule
-- registry. Nullable: findings ingested before this column existed, or from a CLI/Action version
-- that predates it, have no category on file.

alter table findings
  add column if not exists category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'findings_category_valid'
  ) then
    alter table findings
      add constraint findings_category_valid
      check (category is null or category in (
        'electrical', 'manufacturability', 'assembly', 'testability', 'sourcing', 'release', 'unclassified'
      ));
  end if;
end;
$$;
