-- Queue one durable, tenant-scoped erasure request when the GitHub App is uninstalled.
--
-- Marketplace cancellation already has its own independently idempotent request class. Keep the
-- uninstall request separate so either lifecycle can be audited without one suppressing the other,
-- while still preventing webhook retries/concurrent deliveries from creating duplicate active work.
--
-- A real installation.created event cancels an outstanding uninstall request. The cancellation
-- status is explicit rather than overloading completed/failed, so a future erasure executor can
-- fail closed when an installation returns before destructive work begins.
alter table erasure_requests
  drop constraint if exists erasure_requests_status_check;

alter table erasure_requests
  add constraint erasure_requests_status_check
  check (status in ('preview','pending','running','completed','failed','blocked_by_hold','canceled'));

create unique index if not exists uq_erasure_requests_active_github_app_uninstall
  on erasure_requests(tenant_id, scope)
  where requested_by = 'github_app_uninstall'
    and scope in ('organization', 'user')
    and status in ('pending', 'running', 'blocked_by_hold');

insert into cloud_schema_migrations (version)
values ('0083_github_app_uninstall_erasure')
on conflict (version) do nothing;
