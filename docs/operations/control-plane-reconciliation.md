# Control-plane Reconciliation and Dead-letter Operations

BoardReadyOps stores lifecycle jobs, external side effects, and reconciliation work in PostgreSQL. The operator API provides a bounded, metadata-only surface for diagnosing dead letters and replaying records that the database has classified as safe.

## Security boundary

The operator API is disabled unless both server-side settings are present:

```dotenv
BOARDREADYOPS_OPERATOR_API_TOKEN=<at-least-32-visible-ASCII-characters>
BOARDREADYOPS_OPERATOR_ACTOR_ID=operator.primary
```

Generate a high-entropy token with an approved secret-management workflow, for example:

```bash
openssl rand -base64 48
```

Store the token in the deployment secret manager. Do not commit it, print it in CI, place it in a URL, or reuse a GitHub credential. `BOARDREADYOPS_OPERATOR_ACTOR_ID` is a stable, non-secret audit identity and must contain only letters, digits, `.`, `_`, `:`, or `-`.

Expose these endpoints only through a private network, authenticated administrative proxy, or equivalent restricted operations boundary. The bearer token is an application control, not a replacement for network isolation, TLS, request logging policy, or operator access review.

Requests authenticate with:

```http
Authorization: Bearer <BOARDREADYOPS_OPERATOR_API_TOKEN>
```

Authentication uses constant-time comparison after byte-length validation. The configured actor identifier is written to replay operations; callers cannot choose the audit actor in a request body or header.

## List tenant dead letters

```http
GET /api/v1/operator/installations/{installationId}/dead-letters
```

Optional query parameters:

- `limit`: integer from 1 through 100; default `50`.
- `before`: ISO-8601 timestamp returned as `nextBefore` by the preceding page.

Example:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer ${BOARDREADYOPS_OPERATOR_API_TOKEN}" \
  "https://boardreadyops.example/api/v1/operator/installations/${INSTALLATION_ID}/dead-letters?limit=50"
```

The response contains bounded operational metadata such as item type, item identifier, repository name, stable reason code, error class, attempt count, failure time, and whether replay is safe. It never includes webhook actions, outbox payloads, source content, findings, credentials, or raw database errors.

Cross-tenant identifiers are not disclosed. PostgreSQL resolves every row through the supplied installation scope.

## Replay one safe dead letter

```http
POST /api/v1/operator/installations/{installationId}/dead-letters/{itemType}/{itemId}/replay
```

`itemType` is `job` or `outbox`. Every replay requires a unique, caller-generated idempotency key:

```bash
OPERATION_ID="$(uuidgen)"
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${BOARDREADYOPS_OPERATOR_API_TOKEN}" \
  --header "Idempotency-Key: ${OPERATION_ID}" \
  "https://boardreadyops.example/api/v1/operator/installations/${INSTALLATION_ID}/dead-letters/job/${ITEM_ID}/replay"
```

Successful replay returns `replayed`. Retrying the same operation ID with the same installation, item type, and item ID returns `already_applied` and the same audit event identifier. Reusing an operation ID for a different request is rejected by PostgreSQL.

Outcome mapping:

| HTTP status | Outcome | Operator action |
| --- | --- | --- |
| `200` | `replayed` or `already_applied` | Record the returned audit event ID and watch queue/outbox health. |
| `404` | `not_found` | Confirm installation scope and item ID; no ownership information is disclosed. |
| `409` | `not_replayable` | Reconciliation or manual incident handling is required. Do not force a duplicate external side effect. |
| `503` | unavailable | Restore operator configuration or database health before retrying with the same idempotency key. |

A replay that changes state writes a `control_plane.dead_letter_replayed` audit event. The event binds the installation, configured actor, operation ID, item type, and item ID without persisting tenant payload content.

## Replay checklist

Before replaying:

1. confirm the installation and repository scope;
2. classify the stable failure reason;
3. verify that the row reports `replaySafe: true`;
4. ensure the external side effect cannot already have succeeded without acknowledgement;
5. create one operation ID and preserve it for all retries; and
6. record the returned audit event ID in the incident timeline.

Workflow dispatches with uncertain delivery remain non-replayable until installation-scoped GitHub reconciliation proves the authoritative workflow state.

## Credential rotation

Rotate the operator token through the secret manager and deployment platform. During rotation, deploy the new value atomically; requests using the previous token must begin returning `401`. Keep the actor ID stable when the same operator identity continues to own the action. Change it when responsibility transfers so later audit events remain attributable.

After rotation, verify an authenticated list request, an unauthenticated `401`, and the absence of bearer values in application, proxy, and tracing logs.

## GitHub workflow state reconciliation

The control-plane worker periodically detects current GitHub Actions execution attempts that have a persisted workflow run ID but remain non-terminal beyond the observation window. Each candidate is inserted into the durable reconciliation queue with an explicit deadline. The worker then mints a short-lived token for the candidate's persisted `github_installation_id` and reads exactly one workflow run from the scoped target repository.

Configure the initial cadence with:

```dotenv
BOARDREADYOPS_RECONCILIATION_CONCURRENCY=2
BOARDREADYOPS_RECONCILIATION_POLL_MS=5000
BOARDREADYOPS_RECONCILIATION_DETECT_INTERVAL_MS=30000
BOARDREADYOPS_RECONCILIATION_OBSERVATION_SECONDS=300
BOARDREADYOPS_RECONCILIATION_DEADLINE_SECONDS=1800
BOARDREADYOPS_RECONCILIATION_NEXT_CHECK_SECONDS=60
```

`BOARDREADYOPS_RECONCILIATION_OBSERVATION_SECONDS` prevents normal callback latency from creating premature work. `BOARDREADYOPS_RECONCILIATION_DEADLINE_SECONDS` is the maximum time a detected attempt may remain ambiguous. Pending GitHub state, a temporary `404`, and `completed / success` without a signed callback are rechecked at the configured interval until that deadline. PostgreSQL leases prevent two replicas from applying the same observation, and every terminal repair verifies that the attempt is still the release run's current attempt.

Stable terminal mappings are intentionally fail-closed:

| Authoritative GitHub state | BoardReadyOps outcome | Public failure reason |
| --- | --- | --- |
| `completed / success` before deadline, callback absent | recheck | `github_result_callback_pending` |
| `completed / success` after deadline, callback absent | `failed` | `github_result_callback_missing` |
| `completed / timed_out` | `timed_out` | `github_workflow_timed_out` |
| `completed / <other conclusion>` | `failed` | `github_workflow_<conclusion>` |
| workflow run returns `404` before deadline | recheck | `github_workflow_not_found` |
| workflow run remains `404` after deadline | `failed` | `github_workflow_not_found` |
| still pending after the explicit deadline | `timed_out` | `github_workflow_deadline_exceeded` |
| GitHub lookup unavailable before deadline | retry | `github_lookup_failed` |
| GitHub lookup unavailable after deadline | `failed` | `github_workflow_lookup_failed` |

A GitHub `success` conclusion alone never marks a BoardReadyOps release successful. Success requires the existing signed, attempt-bound result callback and digest validation. Reconciliation reads no workflow logs, jobs, artifacts, inputs, source, findings, or commit messages. Installation tokens remain in memory only, and persisted audit metadata contains bounded status/conclusion identifiers rather than GitHub response bodies.

Relevant structured worker events are `worker.reconciliation_detected`, `worker.reconciliation_claim_failed`, `worker.reconciliation_detection_failed`, and `worker.reconciliation_terminal`. The readiness response includes the reconciliation configuration state and latest poll/success timestamps.

### Missed-callback incident check

1. Confirm `reconciliationConfigurationValid` is `true` on `/health/ready`.
2. Check `worker.reconciliation_detected` and `worker.reconciliation_terminal` without enabling payload logging.
3. Confirm the installation is active and the GitHub App can read Actions state in the target repository.
4. Inspect the stable reconciliation outcome and audit event; do not use private workflow logs as application telemetry.
5. Replay only records explicitly reported as safe by the dead-letter API. An uncertain dispatch without a persisted workflow run ID remains non-replayable and requires a later reconciliation path or manual incident decision.

## GitHub Check Run publication reconciliation

After a signed terminal result is accepted, GitHub Check Run publication can still fail or become inconsistent. The worker detects terminal release runs with a persisted Check Run ID and no `github_check_published_at` timestamp after the same observation window used by workflow reconciliation. It claims a `release_run / reporting_stale` reconciliation lease and reads exactly that Check Run with a short-lived installation token.

The persisted signed result remains authoritative. Schema v21 records the exact GitHub-facing conclusion used during initial publication, including neutral conclusions for accepted at-risk results; a database trigger preserves this invariant for rolling-upgrade writes from older replicas. Reconciliation never changes release-run status, decision, conclusion, findings, or accepted payload. If the Check Run already has the expected terminal conclusion, only publication metadata is repaired. If it is queued, in progress, or has a different conclusion, the worker updates it with the persisted expected conclusion and a generic summary that points operators to the BoardReadyOps run. Findings, source, report links, artifacts, and GitHub response bodies are not copied into the reconciliation context or worker logs.

| Observation | Before deadline | At or after deadline |
| --- | --- | --- |
| Check Run identity/binding mismatch | record `github_check_run_binding_mismatch`; do not update | record `github_check_run_binding_mismatch`; do not update |
| expected terminal status/conclusion | mark publication reconciled | mark publication reconciled |
| pending or mismatched Check Run | update and mark reconciled | update; record `github_check_run_update_failed` if convergence fails |
| `404` | recheck as `github_check_run_not_found` | record stable `github_check_run_not_found` |
| lookup unavailable | bounded retry | record stable `github_check_run_lookup_failed` |

Stable failure recording updates `release_run_results.last_publication_error`, completes the reconciliation item, and appends `control_plane.github_check_run_reconciliation_failed`. It does not turn a successful release into a failure. A terminal reconciliation row prevents the same unchanged publication failure from being rediscovered indefinitely.

Relevant structured events are `worker.check_run_reconciliation_detected`, `worker.check_run_reconciliation_detection_failed`, `worker.check_run_reconciliation_claim_failed`, and `worker.check_run_reconciliation_terminal`. `/health/ready` includes `lastCheckRunReconciliationPollAt` and `lastSuccessfulCheckRunReconciliationAt`.

### Check Run drift incident check

1. Confirm `reconciliationConfigurationValid` is `true` and the Check Run reconciliation poll timestamp is advancing.
2. Correlate `worker.check_run_reconciliation_terminal` by safe reconciliation ID; do not enable GitHub response-body logging.
3. Confirm the GitHub App installation still has Checks read/write access for the target repository.
4. Inspect `last_publication_error` and the corresponding audit event. The accepted terminal BoardReadyOps result remains authoritative.
5. After correcting permissions or a GitHub incident, use a controlled operator remediation rather than changing the release result or manually fabricating findings.

## SLO alert incident response

The initial GitHub Cloud GA policy is `github-cloud-ga-v1`. It evaluates privacy-safe aggregate SLI snapshots and emits these structured events:

- `worker.control_plane_slo_evaluation`: policy version, aggregate health, and active signal names for every successful snapshot;
- `worker.control_plane_slo_firing`: one transition when a signal first satisfies its duration, consecutive-snapshot, trend, or volume gate;
- `worker.control_plane_slo_recovered`: one transition when an active signal returns to a healthy value; and
- `worker.control_plane_slo_failed`: evaluation failure with only `errorClass`.

Use this incident sequence:

1. Open the latest `worker.control_plane_slo_evaluation` and identify the active aggregate signals.
2. Treat a critical firing transition as a platform page. Treat a warning transition as operational triage requiring ownership and a recorded next check.
3. Correlate lifecycle queue age, outbox lag, reconciliation backlog, recent repairs, terminal failures, worker health, and GitHub service status. Do not enable private source, findings, payload, workflow-log, or credential logging.
4. For lifecycle or outbox backlog, verify healthy claim loops and database leases before replaying anything. Use the dead-letter API only for records explicitly marked replay-safe.
5. For stale attempts or callback failures, follow the GitHub workflow state reconciliation procedure above and preserve its fail-closed result mapping.
6. Close or downgrade the incident only after a `worker.control_plane_slo_recovered` transition and confirmation that the underlying aggregate signal is stable.

SLI collection and SLO evaluation are observability paths and do not affect worker readiness or queue processing. The evaluator's debounce state is process-local; a worker restart resets local duration, consecutive-snapshot, and backlog-trend history. A restart is not a recovery signal, so durable alerting must retain the existing incident until a real recovery transition arrives.
