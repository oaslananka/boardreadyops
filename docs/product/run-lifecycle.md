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

## Phased adoption

The schema and typed `ControlPlaneRunTransitionStore` are additive foundations. Existing lifecycle, outbox, callback, supersession, and reconciliation writers remain compatible while they are migrated in focused follow-up slices. Until those callers are migrated, the versioned function protects only operations that explicitly use the new store; it is not yet the sole write path for every release-run mutation.
