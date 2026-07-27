# Guarded Workflow-Dispatch Completion Design

## Context

Schema version 23 introduced optimistic-concurrency versions and the atomic `boardreadyops_transition_release_run_state` contract. The first production caller migration is workflow-dispatch completion in the transactional outbox. This path is a good first boundary because the external GitHub delivery is already represented by one leased, idempotent outbox effect and stale delivered work already converges to reconciliation-required state after lease expiry.

Reading the current version at completion time would not provide meaningful optimistic concurrency: an intervening writer could increment the version while leaving the same status and attempt pointer, and completion would unknowingly accept the new version. The expected run and attempt versions must therefore be captured when the workflow-dispatch effect is created and remain immutable for that effect.

## Scope

- Add expected run and attempt version bindings to workflow-dispatch outbox rows.
- Capture the versions in PostgreSQL at effect insertion time rather than trusting caller-supplied values.
- Backfill existing workflow-dispatch rows during migration.
- Replace `boardreadyops_complete_workflow_dispatch_effect` so run and attempt status changes use `boardreadyops_transition_release_run_state` with the effect-bound versions.
- Preserve the existing worker/store API and `completed`/`stale` outcomes.
- Preserve delivery-uncertain reconciliation behavior for stale delivered effects.

This slice does not migrate Check Run creation, safe-mode completion, supersession, callback/result ingestion, timeout, or reconciliation mutations.

## Data model

Schema version 24 adds nullable bigint columns to `control_plane_outbox`:

- `expected_run_version`;
- `expected_attempt_version`.

Both values must be non-negative when present. A workflow-dispatch effect must have both values and an execution-attempt ID. Other effect types must keep both values null.

A `before insert` trigger derives both versions from the persisted release run and execution attempt. It validates that the attempt belongs to the run and is the run's current attempt. The trigger never trusts a supplied version and does not run on idempotent conflict updates, so replay cannot refresh the original expectation.

Existing workflow-dispatch rows are backfilled from their persisted run and attempt records before the constraint is validated. Rows that are already stale still keep their original identities; the completion function additionally checks the current-attempt pointer through the v23 transition contract.

## Completion contract

The replacement `boardreadyops_complete_workflow_dispatch_effect`:

1. locks the leased workflow-dispatch outbox row;
2. loads its release run, attempt, and creation-time expected versions;
3. calls `boardreadyops_transition_release_run_state` with fixed expected states `queued` and `dispatching`, the bound versions, current attempt ID, and next states `dispatched` and `dispatched`;
4. maps any non-`applied` result to the existing `stale` outcome without completing the outbox row;
5. after an applied transition, records the GitHub workflow dispatch ID, optional run URL, and dispatched timestamp on the now-versioned attempt;
6. completes the leased outbox row atomically.

The transition reason is `workflow_dispatch_completed`. The v23 function writes one run event and one attempt event, each with an exact version increment.

## Failure and reconciliation behavior

- A changed run version, changed attempt version, wrong current-attempt pointer, changed status, lost lease, or missing binding returns `stale`.
- A stale completion does not update run state, attempt state, transition events, dispatch metadata, or outbox completion.
- If GitHub delivery had started, lease expiry continues to move the effect to `reconciliation_required` with `delivery_uncertain`.
- Any unexpected database exception rolls back the whole transaction and is handled by the existing worker failure path.

## Security and privacy

- Version bindings are derived by PostgreSQL from foreign-key-scoped records.
- Callers cannot select another run version or attempt version.
- No source, findings, artifacts, workflow logs, webhook payloads, credentials, or raw errors are added.
- The outbox continues to own external-side-effect idempotency and delivery uncertainty.

## Testing

- Unit migration tests cover schema ordering, version columns, insert-time trigger, backfill, constraints, guarded function call, fixed expected states, reason code, and stale mapping.
- PostgreSQL tests prove versions are captured when the effect is created, successful completion increments both versions and writes two events, run-version drift and attempt-version drift fail closed even when status and attempt identity are unchanged, and delivered stale work still converges to reconciliation-required state.
- Existing outbox, migration, lifecycle, worker, and monorepo integration suites remain green.
