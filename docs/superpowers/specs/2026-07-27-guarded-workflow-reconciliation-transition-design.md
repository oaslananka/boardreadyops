# Guarded Workflow Reconciliation Transition Design

## Goal

Move authoritative GitHub workflow reconciliation terminalization onto the versioned release-run transition contract introduced by schema v23. Reconciliation must detect stale run or attempt state before an external GitHub lookup when possible and must never apply a terminal result to a newer lifecycle state.

## Current risk

A workflow reconciliation item records tenant and entity identity but not the run and attempt status/version pair that made the item necessary. The worker may lease the item, observe GitHub, and then directly update the current attempt and run even if another actor changed either entity after detection. Pointer checks prevent applying to a different attempt, but version-only or status drift can still make the observation stale.

## Detection-time snapshot

Schema v26 adds four nullable columns to `control_plane_reconciliation_items`:

- `expected_run_status`
- `expected_run_version`
- `expected_attempt_status`
- `expected_attempt_version`

A database trigger binds all four fields when an item is inserted for an `execution_attempt` with reason `callback_missing` or `attempt_stale`. The trigger runs after the existing scope-validation trigger by trigger-name ordering, so repository, run, and attempt scope are already authoritative.

The trigger requires:

- the attempt belongs to the scoped run,
- the attempt is the run's current execution attempt,
- the run is in `queued`, `dispatched`, or `running`,
- the attempt is in `dispatched`, `in_progress`, `uploading_artifacts`, or `reporting`,
- both versions are non-negative.

The snapshot and reconciliation identity are immutable after insert. Other reconciliation item kinds keep all four fields null. Existing workflow reconciliation rows are backfilled from their current run and attempt before the new constraint is validated.

## Context fail-closed behavior

`boardreadyops_github_workflow_reconciliation_context` continues to return only privacy-safe GitHub lookup data. It additionally requires the current run and attempt status/version pair to equal the stored snapshot and the attempt to remain the current pointer.

If any field drifted, the context query returns no row. The existing worker then completes the reconciliation item as `context_stale` without calling GitHub.

## Guarded terminalization

`boardreadyops_apply_github_workflow_reconciliation` keeps the reconciliation lease and observation validation contract.

1. Lock the reconciliation item, run, and attempt.
2. If the run or attempt is already terminal, preserve the existing `already_terminal` outcome and complete the reconciliation item without a repair.
3. Otherwise call `boardreadyops_transition_release_run_state` with the stored expected statuses, versions, current attempt ID, requested terminal run status, requested terminal attempt status, and reason `github_workflow_reconciled`.
4. If the guarded transition does not return `applied`, return `stale` without changing the reconciliation item, audit log, failure metadata, or transition history.
5. On success, attach the public failure class/message to the attempt at the returned terminal attempt version without incrementing the version again.
6. Complete the reconciliation item and write the existing tenant-scoped audit event.

The guarded transition increments both entity versions, writes append-only run and attempt transition events, and sets terminal timestamps and run duration atomically.

## Race behavior

- Drift before context load prevents the GitHub API call and completes the item as `context_stale`.
- Drift after context load but before apply returns `stale`; the lease recovery path retries, and the next context load closes the item as stale.
- A callback that terminalizes the entities between context and apply yields `already_terminal` and does not write duplicate transition events.
- Lease loss raises the existing serialization-style error after any attempted mutation, rolling back the transaction.

## Compatibility

The TypeScript operations-store and worker APIs do not change. Generic manual reconciliation enqueue is covered by the same database trigger, so it cannot create an unversioned workflow reconciliation item. Existing non-workflow reconciliation behavior remains unchanged.

## Verification

- Static migration tests cover schema ordering, snapshot shape, trigger ordering and immutability, context predicates, guarded apply, audit behavior, and absence of direct terminal status updates.
- PostgreSQL tests cover successful repair, version increments, transition events, context drift, post-context apply drift, already-terminal races, snapshot immutability, and tenant-scoped audit completion.
- Full migration replay, required integration, PostgreSQL matrix, unit, typecheck, dist, and security gates remain mandatory before merge.
