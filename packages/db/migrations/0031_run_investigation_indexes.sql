-- Bounded hosted-dashboard investigation queries.
-- Every index remains run-prefixed so one tenant's large result set cannot force
-- a cross-run scan while filtering, sorting, or paginating findings and artifacts.

create index if not exists findings_run_severity_waiver_idx
  on findings(run_id, lower(severity), waived_at, rule_id, id);

create index if not exists findings_run_rule_path_idx
  on findings(run_id, rule_id, path, id);

create index if not exists findings_run_path_rule_idx
  on findings(run_id, path, rule_id, id);

create index if not exists artifacts_run_uploaded_idx
  on artifacts(run_id, uploaded_at desc, id desc);

create index if not exists artifacts_run_name_idx
  on artifacts(run_id, name, uploaded_at desc, id desc);

create index if not exists artifacts_run_size_idx
  on artifacts(run_id, bytes desc, uploaded_at desc, id desc);

create index if not exists artifacts_run_role_kind_idx
  on artifacts(run_id, lower(role), lower(kind), uploaded_at desc, id desc);

create index if not exists artifacts_run_kind_idx
  on artifacts(run_id, lower(kind), uploaded_at desc, id desc);
