# Transactional outbox

BoardReadyOps Cloud uses PostgreSQL as the authoritative boundary for webhook jobs, release-run state, and required GitHub side effects. The control plane does not call GitHub while accepting a webhook, and the lifecycle worker does not issue Check Run or workflow-dispatch requests directly.

## Processing model

The processing path is split into two independently leased queues:

1. The webhook endpoint verifies and normalizes a GitHub delivery, writes `webhook_inbox` and `control_plane_jobs` in one database transaction, and returns HTTP 202.
2. The lifecycle worker claims a control-plane job and applies installation, repository, or release-run state changes.
3. A release-run transition writes the required `control_plane_outbox` record in the same transaction as the authoritative state change.
4. The outbox worker claims the effect with `FOR UPDATE SKIP LOCKED`, records `delivery_started_at`, performs the GitHub request, and commits the matching authoritative transition.

The lifecycle and outbox consumers run independently. A slow GitHub API request or a poisoned outbox record therefore does not prevent unrelated webhook jobs from being planned.

## Effect types

The schema supports these version-1 effects:

- `github.check_run.create`
- `github.workflow.dispatch`
- `github.check_run.complete`

Every effect has a deterministic, unique idempotency key and a bounded JSON payload. Credentials, installation tokens, private keys, and webhook secrets are never written to the outbox.

## Replay and reconciliation

Check Run creation is replay-safe. The client lists Check Runs for the target commit and reuses the record whose name and `external_id` match the BoardReadyOps release-run ID. It creates a new Check Run only when that identity is absent.

Workflow dispatch is treated as non-idempotent after delivery begins. The client requests GitHub workflow-run details and persists the returned `workflow_run_id`. When a worker loses its lease after `delivery_started_at` is recorded but before completion is committed, the record moves to `reconciliation_required` instead of returning to the automatic retry queue.

Ordinary dead-letter effects can be replayed with `boardreadyops_replay_control_plane_outbox`. A `reconciliation_required` workflow dispatch cannot use that function. An operator must first determine whether GitHub created a workflow run for the persisted repository, workflow, release-run ID, and execution-attempt ID. The record should be repaired or superseded only after that external state is known.

## Failure states

- `available`: ready for a bounded lease claim.
- `leased`: owned by one worker until `lease_expires_at`.
- `completed`: external effect and authoritative transition were recorded.
- `dead_letter`: bounded attempts were exhausted or a permanent failure was classified.
- `reconciliation_required`: delivery may have occurred, so blind replay is unsafe.

Completion functions verify the current lease owner and the expected effect type. A stale worker cannot complete an effect after another worker has recovered its lease. Workflow completion also requires the matching release run and execution attempt to advance successfully; otherwise the outbox record remains recoverable and eventually enters reconciliation.

## Metrics and alerts

The worker emits aggregate queue metrics without installation, repository, delivery, or payload dimensions:

- available and leased effect counts
- retrying and dead-letter counts
- reconciliation-required count
- oldest available effect age
- outbox lag

Alert on any sustained `reconciliation_required` count above zero. Investigate dead-letter growth, an oldest available age above 30 seconds while workers are healthy, or claim latency above 250 milliseconds.

## External broker transition triggers

PostgreSQL remains the default queue. Evaluate an external broker only after database and index tuning when at least one measured condition persists:

- claim latency remains above 250 milliseconds;
- oldest available effect age remains above 30 seconds while workers are healthy; or
- throughput remains above 500 effects per second for 15 minutes.

A broker migration requires a separate architecture decision. It must preserve the database transaction boundary, deterministic idempotency keys, lease ownership, dead-letter visibility, and the non-replayable workflow-dispatch reconciliation rule.
