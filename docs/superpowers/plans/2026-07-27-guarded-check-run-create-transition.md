# Guarded Check Run Create Transition Implementation Plan

> Execute each task test-first and commit each independently.

## Task 1: Lock the schema v25 contract

**Files**

- Create: `tests/unit/db/guarded-check-run-create-transition-migration.test.ts`
- Modify: `tests/unit/db/migrations.test.ts`

**Steps**

1. Add failing assertions for migration `0025_guarded_check_run_create_transition.sql` and schema version 25.
2. Assert Check Run creation effects require `expected_run_version` but no attempt version.
3. Assert workflow-dispatch binding remains unchanged.
4. Assert idempotent replay preserves existing expected versions.
5. Assert safe-mode completion calls the v23 transition function.
6. Assert dispatch preparation increments the run version when binding a new attempt.
7. Run focused tests and confirm RED because migration v25 does not exist.

## Task 2: Implement the generalized outbox binding and guarded completion

**Files**

- Create: `packages/db/migrations/0025_guarded_check_run_create_transition.sql`
- Modify: `packages/db/src/index.ts`

**Steps**

1. Backfill expected run versions for Check Run creation effects.
2. Replace the v24 version-binding constraint with the v25 effect-specific shape constraint.
3. Replace the workflow-only trigger with a generalized Check Run creation/workflow-dispatch binding trigger.
4. Redefine `boardreadyops_complete_check_run_create_effect` with atomic version validation.
5. Preserve `check_run_conflict`, safe-mode, GitHub Actions, and runner-disabled outcomes.
6. Run focused migration tests and typecheck until GREEN.
7. Commit the migration slice.

## Task 3: Prove behavior on PostgreSQL 17

**Files**

- Modify: `tests/integration/transactional-release-run-outbox-postgres.test.ts`

**Steps**

1. Update the successful dispatch expectation to run version 1 and dispatch binding 1/0.
2. Add a successful safe-mode test with a release-run transition event.
3. Add a runner-disabled test that leaves the run queued.
4. Add stale run-version and current-pointer drift tests that prove no mutations remain.
5. Add Check Run conflict quarantine coverage.
6. Add idempotent replay coverage proving the original Check Run creation version binding is immutable.
7. Apply all migrations to an empty PostgreSQL 17 database and run the focused test file.
8. Commit the PostgreSQL proof slice.

## Task 4: Run broad verification and deliver

**Steps**

1. Run root lint and typecheck.
2. Reapply all migrations and confirm no pending migrations.
3. Run the required monorepo integration suite and full PostgreSQL matrix.
4. Run the mandatory pre-push unit/dist/size/security gates.
5. Push `feat/guard-check-run-create-transition`.
6. Open a PR relating to #23.
7. Wait for PR CI/security, squash merge when clean, and verify main CI/security.
8. Update #23 with evidence and remaining direct-writer scope.
9. Fast-forward local main and remove the worktree, branch, and disposable PostgreSQL container.
