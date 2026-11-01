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
export function signedRunnerPassSql(alias: "run" | "release_runs"): string {
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
