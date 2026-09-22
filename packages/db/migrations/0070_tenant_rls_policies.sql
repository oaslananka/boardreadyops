-- PostgreSQL Row-Level Security (RLS) tenant isolation policies.
-- Enables RLS on tenant-owned tables and enforces tenant boundaries.

alter table repositories enable row level security;
alter table release_runs enable row level security;
alter table findings enable row level security;
alter table artifacts enable row level security;
alter table reviews enable row level security;
alter table api_tokens enable row level security;

-- Create policy functions/rules if app sets session tenant context: app.current_tenant_id
drop policy if exists repositories_tenant_isolation on repositories;
create policy repositories_tenant_isolation on repositories
  using (
    current_setting('app.current_tenant_id', true) is null
    or current_setting('app.current_tenant_id', true) = ''
    or installation_id = current_setting('app.current_tenant_id', true)
  );

drop policy if exists release_runs_tenant_isolation on release_runs;
create policy release_runs_tenant_isolation on release_runs
  using (
    current_setting('app.current_tenant_id', true) is null
    or current_setting('app.current_tenant_id', true) = ''
    or repository_id in (
      select id from repositories where installation_id = current_setting('app.current_tenant_id', true)
    )
  );

insert into cloud_schema_migrations (version)
values ('0070_tenant_rls_policies')
on conflict (version) do nothing;
