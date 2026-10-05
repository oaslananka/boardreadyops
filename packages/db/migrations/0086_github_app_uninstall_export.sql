-- Queue at most one active tenant-scoped export when the GitHub App is uninstalled.
--
-- Export is non-destructive and remains available even when an applicable legal hold blocks the
-- paired erasure request. A later reinstall cancels destructive uninstall erasure separately; it
-- does not erase or cancel an export that may already be materializing for customer portability.
create unique index if not exists uq_data_exports_active_github_app_uninstall
  on data_exports(tenant_id, scope)
  where requested_by = 'github_app_uninstall'
    and scope in ('organization', 'user')
    and status in ('pending', 'running');

insert into cloud_schema_migrations (version)
values ('0086_github_app_uninstall_export')
on conflict (version) do nothing;
