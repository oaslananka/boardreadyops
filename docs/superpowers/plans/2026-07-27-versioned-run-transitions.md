# Versioned Release-Run Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive optimistic-concurrency transition foundation for release runs and execution attempts.

**Architecture:** Schema version 23 adds entity versions, append-only transition events, and one atomic guarded transition function. A focused TypeScript store validates inputs and decodes outcomes. Existing mutation paths remain compatible and are migrated in later slices.

**Tech Stack:** PostgreSQL PL/pgSQL, TypeScript 6, `pg`, Vitest, PostgreSQL 17 integration tests.

## Global Constraints

- Use expected run status, expected current attempt ID, run version, and optional attempt status/version for every guarded transition.
- Stale, missing, or invalid requests must not mutate state or insert events.
- Transition telemetry must not contain tenant source, findings, artifacts, payloads, credentials, or raw errors.
- Migration must be additive and safe for existing rows and writers.

---

### Task 1: Add schema-version 23 migration contract

**Files:**
- Create: `packages/db/migrations/0023_versioned_release_run_transitions.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`
- Create: `tests/unit/db/versioned-release-run-transitions-migration.test.ts`

**Interfaces:**
- Produces: `boardreadyops_transition_release_run_state(...)` returning outcome and authoritative run/attempt states and versions.

- [ ] Write migration tests asserting version columns, transition table, append-only trigger, allowed-edge helpers, guarded function checks, and schema ordering.
- [ ] Run the focused tests and verify they fail because migration 23 is absent.
- [ ] Implement the additive migration and schema-version/model exports.
- [ ] Run the focused tests and verify they pass.
- [ ] Commit the migration slice.

### Task 2: Add typed transition store

**Files:**
- Create: `packages/db/src/control-plane-run-transition-store.ts`
- Create: `tests/unit/db/control-plane-run-transition-store.test.ts`

**Interfaces:**
- Produces: `createControlPlaneRunTransitionStore(executor)` and `ControlPlaneRunTransitionStore.transition(input)`.
- Consumes: `boardreadyops_transition_release_run_state` from Task 1.

- [ ] Write tests for valid parameter binding, stale/not-found/invalid outcomes, numeric version decoding, identifier/status/reason validation, and malformed rows.
- [ ] Run the store tests and verify they fail because the store does not exist.
- [ ] Implement minimal validation and decoding.
- [ ] Run store and migration tests and verify they pass.
- [ ] Commit the store slice.

### Task 3: Prove adversarial PostgreSQL behavior

**Files:**
- Create: `tests/integration/versioned-release-run-transitions-postgres.test.ts`
- Modify: `docs/product/run-lifecycle.md`

**Interfaces:**
- Consumes: migration and store contracts from Tasks 1-2.

- [ ] Write PostgreSQL tests for successful paired transition, stale run version, stale attempt version, wrong attempt pointer, invalid edge, terminal timestamps, version increments, event scope, and append-only rejection.
- [ ] Run against an isolated PostgreSQL 17 container and verify the tests fail before any required fixes.
- [ ] Make only the minimal migration/store fixes required by the integration tests.
- [ ] Update lifecycle documentation with versioned transition semantics and phased rollout.
- [ ] Run focused unit and integration suites, typecheck, lint, and migration tests.
- [ ] Commit the integration/docs slice.

### Task 4: Validate and publish

**Files:**
- No new production files expected.

- [ ] Run pre-commit hooks.
- [ ] Run full unit tests, PostgreSQL integration tests relevant to lifecycle/outbox/reconciliation, typecheck, dist verification, and size budgets.
- [ ] Push the feature branch and open a PR linked to #23.
- [ ] Wait for required CI/security checks.
- [ ] Merge only when all required checks pass.
- [ ] Update #23 with completed evidence and the next caller-migration slice.
