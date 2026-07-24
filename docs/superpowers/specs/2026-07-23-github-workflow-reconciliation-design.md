# GitHub Workflow Reconciliation Design

## Goal

Converge execution attempts whose GitHub Actions workflow state is known but whose signed result callback never arrived. This slice extends issue #190 without closing it; Check Run drift, broad inbox/job detection, SLO alerting, and canaries remain follow-up work.

## Safety boundary

- GitHub state is read only with a short-lived installation token created for the persisted `github_installation_id`.
- Tokens, workflow logs, job logs, artifacts, inputs, source, and findings are never persisted or logged.
- Database context exposes only tenant/resource identifiers, repository owner/name, workflow run ID, current status, and deadlines.
- A successful GitHub workflow without a verified BoardReadyOps result is not treated as a successful release. It becomes the stable terminal failure `github_result_callback_missing`.

## Candidate detection

A PostgreSQL function periodically detects current execution attempts with a persisted GitHub workflow run ID that remain non-terminal beyond a configurable observation delay. It enqueues one active reconciliation item per attempt/reason and assigns an explicit terminal deadline.

- `dispatched` attempts become `callback_missing` candidates.
- `in_progress`, `uploading_artifacts`, and `reporting` attempts become `attempt_stale` candidates.
- Rows without a workflow run ID are excluded because authoritative lookup is not possible by ID in this slice.

## Worker flow

1. Detect candidates in the maintenance loop.
2. Claim reconciliation leases in a dedicated loop.
3. Load a lease-bound, tenant-scoped context.
4. Mint an installation token and query `GET /repos/{owner}/{repo}/actions/runs/{run_id}`.
5. Before the deadline, release queued/in-progress state, 404 observations, and completed-success observations with a bounded next check so an in-flight signed callback can still win the race.
6. Terminalize authoritative non-success conclusions immediately; after the deadline, terminalize success-without-callback, missing workflows, or still-pending workflows with stable failure reasons.
7. Complete the reconciliation item and append an audit event in the same database statement.
8. For transient GitHub or database errors, use the existing bounded retry/dead-letter path.

## Terminal mapping

- GitHub `completed` + `timed_out` => attempt/run `timed_out`, reason `github_workflow_timed_out` immediately.
- GitHub `completed` + non-success conclusion => attempt/run `failed`, reason `github_workflow_<conclusion>` immediately.
- GitHub `completed` + `success` before the deadline => reschedule as `github_result_callback_pending`; after the deadline => fail as `github_result_callback_missing`.
- GitHub 404 before the deadline => reschedule as `github_workflow_not_found`; after the deadline => fail with the same stable reason.
- Non-terminal state after the reconciliation deadline => attempt/run `timed_out`, reason `github_workflow_deadline_exceeded`.
- Persistent GitHub lookup failure after the deadline => attempt/run `failed`, reason `github_workflow_lookup_failed`; before the deadline it remains on bounded retry.

All mutations require the reconciliation lease owner and current release-run attempt pointer. Stale workers cannot overwrite newer attempts.

## Delivery boundary

This PR delivered workflow-run reconciliation and missed-callback convergence. GitHub Check Run display repair is delivered separately by the schema v21 Check Run reconciliation slice; searching uncertain workflow dispatches without a workflow run ID remains follow-up work.
