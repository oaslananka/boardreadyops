/* tsqllint-disable set-quoted-identifier */
-- PostgreSQL migration: SQL Server SET QUOTED_IDENTIFIER is not valid here.
-- Opt-in, preparation-only export reservations. Existing/unbound requests are
-- intentionally not migrated to an installation: a tenant login does not
-- uniquely identify which installation owns a historical export.
--
-- This migration does not dispatch a worker, create an archive, mark exports
-- completed, publish download links, or perform any erasure.
alter table data_exports
  add column if not exists installation_id text,
  add column if not exists preparation_worker text,
  add column if not exists preparation_token text,
  add column if not exists preparation_lease_until timestamptz,
  add column if not exists preparation_attempts integer not null default 0;

create index if not exists idx_data_exports_bound_pending_claim
  on data_exports(installation_id, created_at, id)
  where status = 'pending' and installation_id is not null;

insert into cloud_schema_migrations (version)
values ('0105_data_export_preparation_claims')
on conflict (version) do nothing;
