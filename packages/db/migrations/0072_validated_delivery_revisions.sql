-- 0072_validated_delivery_revisions.sql
-- Binds a shareable workspace revision to the terminal BoardReadyOps run and persisted
-- manufacturing archive that validated the package. A revision without both live evidence
-- references remains visible for provenance, but delivery creation must fail closed.

alter table revisions
  add column if not exists validation_run_id text references release_runs(id) on delete set null;

alter table revisions
  add column if not exists validation_artifact_id text references artifacts(id) on delete set null;

create unique index if not exists revisions_validation_artifact_idx
  on revisions(validation_artifact_id)
  where validation_artifact_id is not null;

create index if not exists revisions_validation_run_idx
  on revisions(validation_run_id)
  where validation_run_id is not null;
