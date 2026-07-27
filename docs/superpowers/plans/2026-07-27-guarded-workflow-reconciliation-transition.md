# Guarded Workflow Reconciliation Transition Implementation Plan

> Execute each task test-first and commit each independently.

## Task 1: Lock the schema v26 contract

**Files**

- Create: `tests/unit/db/guarded-workflow-reconciliation-transition-migration.test.ts`
- Modify: `tests/unit/db/migrations.test.ts`

**Steps**

1. Add failing assertions for migration `0026_guarded_workflow_reconciliation_transition.sql` and schema version 26.
2. Assert detection-time run/attempt status and version snapshot columns.
3. Assert workflow reconciliation items require a complete snapshot while other item kinds require null snapshot columns.
4. Assert snapshot binding follows scope validation and is immutable after insert.
5. Assert context requires exact status/version and current-attempt pointer matches.
6. Assert apply calls the v23 guarded transition and no longer directly terminalizes run or attempt rows.
7. Run focused tests and confirm RED because migration v26 does not exist.

## Task 2: Implement version-bound workflow reconciliation

**Files**

- Create: `packages/db/migrations/0026_guarded_workflow_reconciliation_transition.sql`
- Modify: `packages/db/src/index.ts`

**Steps**

1. Add and backfill the four expected-state columns.
2. Add and validate the workflow-snapshot shape constraint.
3. Add the insert-time binding and update-time immutability trigger.
4. Redefine detection and context functions to use the immutable snapshot.
5. Redefine apply to call `boardreadyops_transition_release_run_state`.
6. Preserve `already_terminal`, reconciliation completion, public failure metadata, and audit behavior.
7. Run focused migration tests and DB package typecheck until GREEN.
8. Commit the migration slice.

## Task 3: Prove adversarial behavior on PostgreSQL 17

**Files**

- Modify: `tests/integration/control-plane-workflow-reconciliation-postgres.test.ts`

**Steps**

1. Extend the successful repair test with run/attempt version increments and two transition events.
2. Assert detection stores the original status/version snapshot and duplicate detection preserves it.
3. Add context tests for run-version, attempt-version, status, and pointer drift.
4. Add a post-context drift test proving apply returns stale without terminal writes, audit, reconciliation completion, or transition events.
5. Add an already-terminal race test proving no duplicate transition event.
6. Add snapshot/identity immutability coverage.
7. Apply all migrations to an empty PostgreSQL 17 database and run the focused test file.
8. Commit the PostgreSQL proof slice.

## Task 4: Run broad verification and deliver

**Steps**

1. Run root lint and typecheck.
2. Reapply all migrations and confirm no pending migrations.
3. Run the required monorepo integration suite and full PostgreSQL matrix.
4. Run the mandatory pre-push unit/dist/size/security gates.
5. Push `feat/guard-workflow-reconciliation-transition`.
6. Open a PR relating to #23.
7. Wait for PR CI/security, squash merge when clean, and verify main CI/security.
8. Update #23 with evidence and remaining direct-writer scope.
9. Fast-forward local main and remove the worktree, branch, and disposable PostgreSQL container.
