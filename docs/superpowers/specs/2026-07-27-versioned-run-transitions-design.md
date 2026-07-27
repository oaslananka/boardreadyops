# Versioned Release-Run Transitions Design

## Context

Issue #23 requires authoritative release-run and execution-attempt transitions to reject stale workers and callbacks by expected state, current attempt identity, and optimistic-concurrency version. BoardReadyOps already has separate attempt records, row locking, transactional outbox delivery, bounded retry, timeout reconciliation, supersession, and stale callback rejection. The missing durable invariant is an explicit versioned transition contract and append-only transition history.

## Scope

This slice adds the database and TypeScript foundation without rewriting every existing lifecycle mutation in one risky change. Later slices will migrate outbox, callback, supersession, and reconciliation callers onto the same contract.

## Data model

- Add `version bigint not null default 0` to `release_runs` and `release_run_attempts`.
- Add `release_run_transition_events` with installation, repository, run, optional attempt, entity type, from/to status, from/to version, reason code, and timestamp.
- Preserve transition events as append-only through a database trigger.
- Keep existing `audit_events`; transition events are the concurrency-specific history, while `audit_events` remains the broader security/operations log.

## Transition contract

Add `boardreadyops_transition_release_run_state` as a `security invoker` PostgreSQL function.

Inputs bind:

- release-run ID;
- expected run status and version;
- expected current attempt ID;
- optional expected attempt status and version;
- next run status;
- optional next attempt status;
- stable reason code; and
- authoritative transition timestamp.

The function locks the run and optional current attempt, verifies tenant-derived scope, validates the expected status/version/attempt pointer, validates allowed status transitions, increments each changed entity version exactly once, applies terminal timestamps, and inserts append-only transition events atomically.

Outcomes are:

- `applied`: transition committed;
- `stale`: expected state, version, or current-attempt binding no longer matches;
- `not_found`: run or bound attempt does not exist;
- `invalid_transition`: requested state edge is not allowed.

No stale or invalid request mutates state or creates a transition event.

## Allowed state edges

Run edges:

- `queued` -> `dispatched`, `running`, `completed`, `failed`, `timed_out`, `cancelled`, `superseded`;
- `dispatched` -> `running`, `completed`, `failed`, `timed_out`, `cancelled`, `superseded`;
- `running` -> `completed`, `failed`, `timed_out`, `cancelled`, `superseded`.

Attempt edges:

- `queued` -> `dispatching`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`;
- `dispatching` -> `dispatched`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`;
- `dispatched` -> `in_progress`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`;
- `in_progress` -> `uploading_artifacts`, `reporting`, `completed`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`;
- `uploading_artifacts` -> `reporting`, `completed`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`;
- `reporting` -> `completed`, `failed`, `cancelled`, `timed_out`, `stale`, `superseded`.

Terminal states have no outgoing edges in this foundation.

## TypeScript API

Add `ControlPlaneRunTransitionStore` with a single typed `transition` method. The store validates identifiers, versions, statuses, and reason codes before calling the SQL function and decodes the authoritative outcome and resulting versions.

## Security and privacy

- Scope is derived through `release_runs -> repositories -> installations`; callers cannot select another installation.
- Transition records contain identifiers, states, versions, reason code, and timestamp only.
- No source, findings, artifacts, workflow logs, webhook payloads, credentials, or raw errors are stored.
- Stale workers cannot overwrite a newer attempt because the current attempt ID and both versions are checked under row locks.

## Testing

- Unit tests assert migration ordering, columns, constraints, append-only trigger, function signature, expected-state checks, version increments, and no-write stale paths.
- Store unit tests cover validation, SQL parameter binding, outcome decoding, and malformed database rows.
- PostgreSQL integration tests cover successful paired transitions, stale run version, stale attempt version, wrong current attempt, invalid edges, terminal timestamping, and append-only event enforcement.
- Existing migration and lifecycle tests remain green.

## Rollout

The migration is additive and backward compatible. Existing writers receive version `0` defaults and continue functioning. New transition callers use the guarded function. Follow-up slices migrate existing lifecycle writers and then make guarded transitions mandatory.
