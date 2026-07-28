# Release run lifecycle

Issue: #23

## Goal

BoardReadyOps should handle duplicate, superseded, retried, cancelled, and timed-out runs predictably for GitHub App readiness checks.

## Lifecycle states

| State | Meaning | Terminal |
| --- | --- | --- |
| queued | Run was accepted and stored before workflow dispatch. | No |
| dispatched | Workflow dispatch was requested. | No |
| running | Runner started and has not reported a terminal result yet. | No |
| completed | Runner finished successfully and produced a decision. | Yes |
| failed | Runner failed or reported an error decision. | Yes |
| timed_out | Runner exceeded its allowed time window. | Yes |
| cancelled | Run was intentionally cancelled because it no longer applies. | Yes |
| superseded | A newer run replaced this run for the same PR/ref. | Yes |

## Idempotency policy

- The natural idempotency key is repository id, pull request number, and commit SHA.
- Re-delivery of the same webhook must return the existing run instead of creating a duplicate.
- A new commit on the same PR should create a new run and mark earlier non-terminal runs for that PR as superseded.
- A manual retry should create a new run attempt only when the previous run is terminal.

## Check-run policy

- Duplicate webhook delivery should not create duplicate check runs.
- Superseded runs should complete their check run as neutral with a clear summary.
- Cancelled runs should complete their check run as neutral.
- Timed-out runs should complete their check run as timed_out.

## Runner callback policy

- Runner callbacks are accepted only for known run ids.
- Terminal run states should not be overwritten by late callbacks unless an explicit retry id matches.
- Late callbacks from superseded runs should be recorded for audit but must not update the active PR decision.

## Timeout policy

- The hosted app should maintain a timeout job or endpoint that marks stale dispatched/running runs as timed_out.
- Timeout threshold should be configurable per installation or deployment.
- Default timeout should be conservative enough for KiCad generation and report upload.

## Acceptance criteria

- Duplicate webhook deliveries are idempotent.
- New PR commits supersede older non-terminal runs for the same PR.
- Late callbacks cannot reverse a newer decision.
- Timed-out and cancelled runs complete GitHub check runs consistently.
- The hosted dashboard shows superseded/cancelled/timed-out states clearly.

## Versioned transition policy

Schema version 23 adds an explicit optimistic-concurrency version to each logical release run and execution attempt. A guarded transition binds all of the following under PostgreSQL row locks:

- the release-run identifier, expected status, and expected version;
- the current execution-attempt identifier;
- the expected attempt status and version when the attempt is also changing;
- the requested next state or states; and
- a stable reason code and authoritative transition timestamp.

`boardreadyops_transition_release_run_state` returns one stable outcome:

| Outcome | Meaning |
| --- | --- |
| `applied` | The expected state still matched and the transition, version increments, terminal timestamps, and event records committed atomically. |
| `stale` | A run status/version, attempt status/version, or current-attempt pointer no longer matched. No state or history row changed. |
| `not_found` | The release run or its bound current attempt did not exist. No state or history row changed. |
| `invalid_transition` | The requested state edge or transition metadata was not allowed. No state or history row changed. |

Every applied entity change increments its version exactly once. `release_run_transition_events` records tenant scope, entity identity, from/to state, from/to version, reason code, and timestamp. The table is append-only and contains no source, findings, artifacts, webhook payloads, credentials, or raw errors.


## Guarded runner lease policy

Schema version 29 binds each runner lease to the authoritative lifecycle snapshot it owns:

- expected logical-run status and version;
- expected execution-attempt status and version; and
- the logical run's current execution-attempt pointer.

A successful lease claim creates a version-zero execution attempt, changes the authoritative attempt pointer, increments the logical-run version once, and appends a `runner_lease_claimed` transition event. Managed and self-hosted runner protocol request and response contracts remain unchanged.

Heartbeats may update lease expiry, stage, progress, message, and attempt heartbeat metadata without creating a lifecycle transition. When the heartbeat advances the attempt from `in_progress` to `uploading_artifacts` or `reporting`, the attempt version increments exactly once, one `runner_lease_heartbeat` event is appended, and the lease snapshot advances to the new attempt version. A repeated heartbeat for the same lifecycle state produces no version increment or transition event.

Relinquish and valid lease expiry are bounded retry paths. They terminalize or stale the current attempt, return the logical run from `running` to `queued`, increment both changed entity versions, and append one tenant-scoped event per entity with reason `runner_lease_relinquished` or `runner_lease_expired`.

Run-version drift, attempt-version drift, or current-attempt pointer drift fails closed. A stale expired lease may be closed operationally so it cannot be reused, but it cannot change the newer logical-run or attempt lifecycle state and cannot append lifecycle transition events for that newer state.

## Production enforcement and observability

Schemas 24 through 29 move workflow-dispatch completion, Check Run creation, workflow reconciliation, newer-commit supersession, runner-result persistence, and runner lease lifecycle changes onto expected-state/version/current-attempt guards. These paths increment versions and append transition evidence at the authoritative PostgreSQL boundary.

The runtime metadata-only lifecycle store is limited to installation and repository CRUD. Durable release-run creation uses `boardreadyops_enqueue_release_run_with_outbox`, while dispatch, Check Run, reconciliation, callback, supersession, and runner-lease state changes use the guarded functions owned by schemas 24 through 29. The `verify:transition-writers` CI gate rejects direct runtime SQL writers for `release_runs` or `release_run_attempts`, rejects the retired lifecycle factory, and verifies that every protected PostgreSQL function is last defined by its expected guarded migration.

The hosted run dashboard exposes a **Lifecycle transitions** timeline from the append-only event table. It returns at most 100 newest-first records and displays only entity type, execution-attempt identifier, from/to status, from/to version, stable reason code, and timestamp. Older runs without versioned events show an explicit empty state. Source, findings, artifacts, webhook payloads, credentials, raw errors, and free-form metadata are not queried for this timeline.

Operational visibility remains split by audience: the dashboard shows per-run state and retry history, Check Runs communicate the current readiness outcome, aggregate SLI/SLO signals cover stale attempts and reconciliation backlog, and durable reconciliation/audit records retain stable recovery outcome codes. Historical SQL in earlier migrations is not active behavior when a later migration replaces the function.
