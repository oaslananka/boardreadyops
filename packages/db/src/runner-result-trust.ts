/**
 * A manufacturing archive can back a revision or guest delivery only while a first-party stored
 * copy is available. GitHub Actions artifacts are temporary and must remain inspect-only.
 */
export function availableManufacturingArchiveSql(
  alias: "archive" | "artifacts" | "evidence_artifact" | "artifact" | "a",
): string {
  return `${alias}.storage_path is not null
    and ${alias}.storage_path <> ''
    and ${alias}.storage_path not like 'github-actions/%'
    and (${alias}.retention_until is null or ${alias}.retention_until > now())`;
}

/**
 * Signed manufacturing evidence records the GH OIDC workflow_dispatch signer
 * ref (the trusted default branch), not the separately reviewed PR checkout ref.
 * This value is independently authenticated and Sigstore-verified on ingestion.
 *
 * The checked-out source commit is validated separately by evidence.source_sha.
 * Never compare source_ref to release_runs.ref: a run can review a feature branch
 * while the protected workflow must execute on the repository default branch.
 */
export function trustedSignerWorkflowRefSql(
  evidenceAlias: "evidence" | "source_proof",
  repositoryAlias: "repositories" | "repository" | "repo" | "evidence_repository",
): string {
  return `${evidenceAlias}.source_ref = ('refs/heads/' || ${repositoryAlias}.default_branch)`;
}

/** A raw completed/pass row is only a preview until its accepted runner attempt is bound. */
export function acceptedRunnerResultSql(alias: "run" | "release_runs"): string {
  return `exists (
    select 1 from release_run_results as accepted
    join release_run_attempts as attempt
      on attempt.id = accepted.execution_attempt_id and attempt.run_id = ${alias}.id
    where accepted.run_id = ${alias}.id
      and accepted.contract_version = 1 and accepted.status = 'completed'
      and accepted.decision is not distinct from ${alias}.decision
      and accepted.execution_attempt_id = ${alias}.execution_attempt_id
      and accepted.result_digest = ${alias}.terminal_result_digest
      and attempt.status = 'completed' and attempt.result_digest = accepted.result_digest
  )`;
}

/** Manufacturing authorizations require an accepted, successful runner result. */
export function signedRunnerPassSql(alias: "run" | "release_runs" | "evidence_run"): string {
  return `exists (
    select 1 from release_run_results as accepted
    join release_run_attempts as attempt
      on attempt.id = accepted.execution_attempt_id and attempt.run_id = ${alias}.id
    where accepted.run_id = ${alias}.id
      and accepted.contract_version = 1 and accepted.status = 'completed'
      and accepted.decision = 'pass' and accepted.conclusion = 'success'
      and accepted.execution_attempt_id = ${alias}.execution_attempt_id
      and accepted.result_digest = ${alias}.terminal_result_digest
      and attempt.status = 'completed' and attempt.result_digest = accepted.result_digest
  )`;
}

/** Never render an unsigned completed preview as a verified pass or fail. */
export function displayedRunnerDecisionSql(alias: "release_runs"): string {
  return `case when ${alias}.status = 'completed'
    and not ${acceptedRunnerResultSql(alias)}
    then 'readiness_not_verified' else ${alias}.decision end`;
}
