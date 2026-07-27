# Guarded Workflow-Dispatch Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavior change and superpowers:verification-before-completion before merge.

**Goal:** Make workflow-dispatch completion the first production status writer to use creation-time optimistic-concurrency bindings and the schema-v23 guarded transition function.

**Architecture:** Schema v24 stores expected run/attempt versions on workflow-dispatch outbox effects, derives them with a PostgreSQL insert trigger, and replaces the completion function while preserving the existing TypeScript and worker API.

**Tech Stack:** PostgreSQL PL/pgSQL, TypeScript 6, Vitest, PostgreSQL 17.

## Constraints

- Never derive the expected version at completion time.
- Never refresh expected versions during idempotent outbox replay.
- Preserve `completed` and `stale` API outcomes.
- Preserve delivery-uncertain reconciliation.
- No mutation may occur for stale or invalid guarded transitions.

### Task 1: Define migration v24 contract

**Files:**
- Create: `packages/db/migrations/0024_guarded_workflow_dispatch_transition.sql`
- Create: `tests/unit/db/guarded-workflow-dispatch-transition-migration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`

- [ ] Write failing tests for schema ordering, expected-version columns, trigger, backfill, constraints, and guarded completion function.
- [ ] Implement the additive migration and schema-version export.
- [ ] Run focused migration tests until green.
- [ ] Commit the migration slice.

### Task 2: Prove real PostgreSQL behavior

**Files:**
- Modify: `tests/integration/transactional-release-run-outbox-postgres.test.ts`

- [ ] Assert expected versions are captured on workflow-dispatch effect creation.
- [ ] Assert successful completion increments run/attempt versions and writes exactly two transition events.
- [ ] Add run-version drift and attempt-version drift adversarial cases that keep status and attempt identity unchanged.
- [ ] Assert stale delivered effects still converge to `reconciliation_required` / `delivery_uncertain`.
- [ ] Run all migrations and the focused PostgreSQL tests on a fresh PostgreSQL 17 database.
- [ ] Make only minimal migration fixes required by real database behavior.
- [ ] Commit the integration slice.

### Task 3: Validate and publish

- [ ] Run focused unit tests, root typecheck/lint, and the full explicit PostgreSQL matrix.
- [ ] Run pre-commit and pre-push unit/dist/size gates.
- [ ] Open a PR relating to #23 without closing it.
- [ ] Merge only after required CI, security, OSV, dependency review, accessibility, and docs checks pass.
- [ ] Verify post-merge main CI/security, clean the worktree, and update #23 with evidence and the next caller-migration boundary.
