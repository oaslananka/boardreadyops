# Control-plane lifecycle reconciliation design

## Problem

GitHub webhook intake writes one `webhook_inbox` row and one `control_plane_jobs` row in a transaction, and normal claim/complete/fail paths update both records atomically. The database nevertheless has no periodic path for repairing historical, manually introduced, or rolling-upgrade drift where a non-terminal inbox has no durable job or where inbox state disagrees with its authoritative job state. Such rows can remain ambiguous without appearing correctly in queue metrics.

## Scope

This slice adds database-backed, tenant-scoped reconciliation for webhook inbox and lifecycle-job drift. It does not add synthetic target-repository canaries or change GitHub workflow/Check Run reconciliation.

## Chosen approach

Extend the existing durable `control_plane_reconciliation_items` framework with a `webhook_inbox` subject type and two stable reason codes:

- `lifecycle_job_missing`: an observed non-terminal inbox has no durable lifecycle job.
- `lifecycle_inbox_state_drift`: an inbox state does not match the authoritative lifecycle-job state.

A periodic detector inserts bounded reconciliation items after the configured observation delay. A dedicated claim path prevents lifecycle items from being consumed by GitHub workflow or Check Run workers. The reconciliation worker applies only internal PostgreSQL repairs and therefore does not require GitHub credentials.

## State authority and repair rules

`control_plane_jobs.status` is authoritative whenever a job exists. The expected inbox projection is:

| Job status | Inbox state | Timestamp behavior |
| --- | --- | --- |
| `available` | `accepted` | clear processing/completion timestamps; copy bounded job error metadata |
| `leased` | `processing` | use `started_at` as the processing timestamp; clear completion timestamp |
| `completed` | `processed` | use `completed_at`; clear normalized actions and errors |
| `dead_letter` | `dead_letter` | use `completed_at`; copy bounded job error metadata |

For `lifecycle_job_missing`, the worker recreates the original `github_webhook.lifecycle` job from persisted inbox metadata, reusing the original `provider:delivery_id` idempotency key and the schema default attempt limit. The inbox returns to `accepted`. A concurrent repair or duplicate delivery is treated as already repaired rather than creating a second job.

Terminal inboxes without jobs are not recreated because they are not ambiguous work. Rows without a resolvable installation are skipped by detection because they cannot be tenant-scoped or audited safely.

## Data model and database functions

Migration `0022_control_plane_lifecycle_reconciliation.sql` will:

1. Allow `webhook_inbox` reconciliation subjects.
2. Extend scope validation so inbox and job subjects resolve through `github_installation_id`, with repository scope populated when available.
3. Add `boardreadyops_detect_control_plane_lifecycle_reconciliation`.
4. Add `boardreadyops_claim_control_plane_lifecycle_reconciliation`.
5. Add `boardreadyops_apply_control_plane_lifecycle_reconciliation`.

Each detected item receives an explicit deadline, next-check time, bounded attempts, tenant scope, and stable reason code. Successful repair completes the reconciliation item with `repaired = true`; no-op convergence completes it with `repaired = false`. Existing reconciliation audit events and SLI repair counts therefore include this slice without a separate telemetry store.

## Worker integration

The maintenance loop runs lifecycle reconciliation detection on the existing detection interval. A dedicated lifecycle-reconciliation loop claims and applies items independently of GitHub client configuration. Readiness metadata exposes the latest poll and latest successful lifecycle reconciliation timestamps. Structured logs contain only worker IDs, reconciliation IDs, counts, statuses, and stable outcome codes.

## Failure handling

Transient database failures use the existing exponential retry and dead-letter path. Lease expiry remains bounded by the reconciliation item attempt limit. Missing or changed subjects return `stale` or `already_repaired`; they do not overwrite newer state. No webhook actions, payloads, source content, findings, credentials, or raw database errors are logged or copied into audit metadata.

## Testing

- Migration contract tests pin the new subject type, detector, claim filter, scope validation, and apply function.
- Store unit tests pin SQL bindings and result decoding.
- PostgreSQL integration tests cover missing-job recreation, all four inbox projections, concurrency/no-op behavior, tenant isolation, and SLI repair accounting.
- Worker unit tests cover successful apply, retry/dead-letter/stale outcomes, and independence from GitHub configuration.
- Runtime and operations-document tests pin wiring, readiness fields, reason codes, and incident steps.

## Out of scope

Synthetic public/private target-repository canaries remain the next slice of issue #190. UI changes are not required.
