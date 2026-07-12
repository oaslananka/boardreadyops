-- Validate the release-run current-attempt pointer after all claim statement
-- mutations complete. Data-modifying CTEs share one snapshot, so a BEFORE
-- trigger cannot observe a sibling CTE that updates release_runs first.

drop trigger if exists runner_job_leases_validate_scope on runner_job_leases;

create constraint trigger runner_job_leases_validate_scope
  after insert or update on runner_job_leases
  deferrable initially deferred
  for each row execute function boardreadyops_validate_runner_job_lease_scope();
