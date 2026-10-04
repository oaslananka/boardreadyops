/* tsqllint-disable set-quoted-identifier */
-- PostgreSQL migration: SQL Server SET QUOTED_IDENTIFIER is not valid here.
-- Release-linked manufacturing outcome pilot foundation.
--
-- A production batch is immutable evidence about what was manufactured after one approved
-- BoardReadyOps release. Tenant scope is derived through release_runs -> repositories;
-- callers never provide a free-standing repository or installation dimension to these rows.

create table if not exists production_batches (
  id text primary key default gen_random_uuid()::text,
  release_run_id text not null references release_runs(id) on delete cascade,
  external_batch_id text not null,
  manufacturer text not null,
  manufactured_on date not null,
  quantity integer not null,
  first_pass_yield_bps integer,
  rework_count integer not null default 0,
  scrap_count integer not null default 0,
  notes text,
  corrective_action text,
  source_kind text not null,
  source_name text,
  source_sha256 text not null,
  imported_at timestamptz not null default now(),
  constraint production_batches_external_id_valid check (
    external_batch_id = btrim(external_batch_id) and char_length(external_batch_id) between 1 and 160
  ),
  constraint production_batches_manufacturer_valid check (
    manufacturer = btrim(manufacturer) and char_length(manufacturer) between 1 and 200
  ),
  constraint production_batches_quantity_valid check (quantity > 0),
  constraint production_batches_yield_valid check (
    first_pass_yield_bps is null or first_pass_yield_bps between 0 and 10000
  ),
  constraint production_batches_rework_valid check (rework_count >= 0),
  constraint production_batches_scrap_valid check (scrap_count >= 0),
  constraint production_batches_notes_valid check (notes is null or char_length(notes) <= 4000),
  constraint production_batches_corrective_action_valid check (
    corrective_action is null or char_length(corrective_action) <= 4000
  ),
  constraint production_batches_source_kind_valid check (source_kind in ('csv', 'api', 'manual')),
  constraint production_batches_source_name_valid check (
    source_name is null or (source_name = btrim(source_name) and char_length(source_name) between 1 and 255)
  ),
  constraint production_batches_source_sha256_valid check (source_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index if not exists production_batches_release_identity_idx
  on production_batches(release_run_id, lower(manufacturer), lower(external_batch_id));

create index if not exists production_batches_release_date_idx
  on production_batches(release_run_id, manufactured_on desc, id);

create table if not exists production_batch_defects (
  id text primary key default gen_random_uuid()::text,
  production_batch_id text not null references production_batches(id) on delete cascade,
  category text not null,
  code text not null,
  defect_count integer not null,
  notes text,
  constraint production_batch_defects_category_valid check (
    category in ('aoi', 'spi', 'functional_test', 'ncr', 'rma')
  ),
  constraint production_batch_defects_code_valid check (
    code = btrim(code) and char_length(code) between 1 and 128
  ),
  constraint production_batch_defects_count_valid check (defect_count > 0),
  constraint production_batch_defects_notes_valid check (notes is null or char_length(notes) <= 2000),
  unique (production_batch_id, category, code)
);

insert into cloud_schema_migrations (version)
values ('0082_production_outcome_batches')
on conflict (version) do nothing;
