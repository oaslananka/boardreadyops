# Guarded Check Run Create Transition Design

## Goal

Move the durable `github.check_run.create` completion path onto the versioned release-run concurrency contract introduced by schema v23 without changing the external worker API or the existing runner-disabled behavior.

## Current risk

A Check Run creation effect is leased and delivered externally before its database completion transaction runs. The current completion function verifies the outbox lease but does not bind the effect to the release-run version that was authoritative when the effect was created. A concurrent run mutation can therefore leave the worker applying an outdated safe-mode terminal transition or binding a new execution attempt to a changed run.

## Version binding

Schema v25 generalizes the outbox version-binding trigger added in v24:

- `github.check_run.create` effects require `release_run_id` and an immutable `expected_run_version`; `expected_attempt_version` remains null.
- `github.workflow.dispatch` effects continue to require immutable run and attempt versions.
- all other effect types keep both expected-version columns null.
- idempotent re-insertion preserves the existing effect's original expected versions.
- existing Check Run creation effects are backfilled to the run version present when v25 is applied.

## Completion behavior

The replacement `boardreadyops_complete_check_run_create_effect` function keeps the current lease, Check Run conflict, and next-effect contracts but applies mutations only after validating the immutable run version.

### GitHub Actions dispatch

For `github.workflow.dispatch` as the next effect:

1. Lock the queued release run at `expected_run_version` and require no current execution attempt.
2. Validate that the persisted Check Run ID is null or equals the ensured ID.
3. Create one `dispatching` attempt at version 0.
4. Bind the new attempt to the run and increment the run version by one because the authoritative execution pointer changed.
5. Persist the Check Run ID.
6. Insert the workflow-dispatch effect. The generalized trigger binds it to the new run version and attempt version.
7. Complete the Check Run creation effect.

Any stale status, version, pointer, or lease returns `stale` with no database mutation.

### Safe-mode completion

For `github.check_run.complete` as the next effect:

1. Use `boardreadyops_transition_release_run_state` to apply `queued → completed` at the expected run version with reason code `check_run_safe_mode_completed`.
2. Preserve the existing neutral decision and duration semantics.
3. Persist the Check Run ID at the returned run version.
4. Insert the Check Run completion effect.
5. Complete the Check Run creation effect.

The guarded transition writes the append-only release-run transition event.

### Runner disabled

When no next effect is planned (`dispatchMode: none`), the function only persists the compatible Check Run ID and completes the outbox effect after validating the expected run version. The run remains queued, matching the current behavior.

## Conflict and recovery behavior

A different already-persisted Check Run ID still moves the leased effect to `reconciliation_required` with `check_run_conflict`. Version or state drift returns `stale`; the worker's existing retry/reconciliation machinery decides the next action. No stale path updates the release run, execution attempts, transition history, next outbox effects, or the current outbox completion state.

## Testing

- Static migration contract tests cover schema ordering, allowed expected-version shapes, replay preservation, guarded safe-mode transition, run-version increment on attempt binding, and stale-safe behavior.
- PostgreSQL tests prove successful dispatch preparation, safe-mode completion, runner-disabled completion, stale run-version rejection, pointer drift rejection, Check Run conflict quarantine, and idempotent replay preservation.
- Existing worker/store unit tests confirm the TypeScript API remains unchanged.
- Full migration replay, monorepo integration, PostgreSQL matrix, unit, typecheck, dist, and security gates remain required before merge.
