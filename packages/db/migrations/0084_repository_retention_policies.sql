-- Repository-scoped managed-artifact retention overrides.
--
-- Absence of a row means "inherit the tenant policy / plan default".
-- A row with NULL retention_days means "retain indefinitely".
-- A row with a positive retention_days value is an explicit finite override.
--
-- Tenant ownership is derived through repository -> installation. We intentionally avoid
-- duplicating tenant_id here so repository moves/deletes cannot leave a stale cross-tenant policy.

create table if not exists repository_retention_policies (
  repository_id text primary key references repositories(id) on delete cascade,
  retention_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repository_retention_policies_days_valid
    check (retention_days is null or retention_days between 1 and 3650)
);

insert into cloud_schema_migrations (version)
values ('0084_repository_retention_policies')
on conflict (version) do nothing;
