# Guarded Runner Result Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Route accepted runner result callbacks through optimistic-concurrency guards and append-only run/attempt transition events without breaking exact replay, atomic findings/artifact/result persistence, lease completion, or GitHub publication.

**Architecture:** Schema v28 adds `boardreadyops_apply_runner_result_state(...)`, a callback-specific PostgreSQL helper that locks the expected logical run and current attempt, verifies status/version/pointer snapshots, applies the established callback status mapping, updates callback metadata, and writes transition events only when status actually changes. The existing single-statement route keeps classification, result/child persistence, audit insertion, and lease completion atomic, but replaces direct run/attempt status updates with one materialized lateral helper call. Exact replay and conflicting/stale classifications bypass the helper.

**Tech Stack:** PostgreSQL 17 PL/pgSQL, TypeScript 6, Next.js route handler, pnpm 11, Vitest 4.

## Global Constraints

- Preserve the public result route and payload contract.
- Preserve exact terminal and nonterminal replay semantics and GitHub republication behavior.
- Preserve one-statement atomicity for accepted callback state, findings, artifacts, result payload, audit event, and verified lease closure.
- Preserve no-attempt callbacks for legacy/GitHub Actions paths.
- Accepted callback state is guarded by expected run status/version/current-attempt identity and expected attempt status/version.
- Result status mapping remains: `queued -> attempt dispatching`, `running -> attempt in_progress`, terminal statuses map directly.
- Callback recovery may terminalize any nonterminal current attempt, matching existing behavior.
- Run/attempt versions increment and transition events are written only when status changes.
- Exact result-digest replay writes no lifecycle version or transition event.
- Transition reason codes use `runner_result_<status>`.
- Introduce no new lint warnings beyond the existing 12 PostgreSQL fixture warnings.

### Task 1: Define schema v28 callback-state helper

**Files:**
- Create: `packages/db/migrations/0028_guarded_runner_result_transition.sql`
- Create: `tests/unit/db/guarded-runner-result-transition-migration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`

- [ ] Write RED tests requiring schema 28, snapshot guards, callback status mapping, metadata updates, conditional version/event increments, and stable outcomes.
- [ ] Run focused tests and verify failure because migration 0028 is absent.
- [ ] Implement `boardreadyops_apply_runner_result_state(...)`.
- [ ] Validate run/attempt snapshots before writes; return `not_found`, `stale`, `invalid_transition`, or `applied`.
- [ ] Support current-attempt-null callbacks without attempt mutation.
- [ ] Update decision, completion/duration, terminal digest, attempt heartbeat/start/completion/result digest atomically.
- [ ] Increment versions and write scoped events only when mapped status differs from current status.
- [ ] Run focused tests and DB package typecheck.
- [ ] Commit as `feat(core): guard runner result transitions`.

### Task 2: Route persistence statement through the helper

**Files:**
- Modify: `apps/web/app/api/v1/runs/result/route.ts`
- Modify: `tests/unit/web/readiness-result-route.test.ts`
- Modify: `tests/unit/web/readiness-result-verified-lease.test.ts`

- [ ] Add run and attempt versions to the locked `existing` snapshot.
- [ ] Add a materialized lateral helper CTE only for `accepted` classification.
- [ ] Map helper `stale`/`not_found` to `stale_attempt` and `invalid_transition` to a stable 409 response.
- [ ] Replace direct run/attempt status updates with read-only accepted-row CTEs based on helper output.
- [ ] Keep findings/artifacts/result/audit/lease CTEs dependent on the accepted helper row.
- [ ] Update route unit tests to reject direct authoritative state writes and require the helper call/version parameters.
- [ ] Verify exact replay still bypasses state mutation and publication behavior remains unchanged.
- [ ] Commit as `feat(web): persist guarded runner results`.

### Task 3: Prove real PostgreSQL behavior

**Files:**
- Modify: `tests/integration/runner-result-postgres.test.ts`

- [ ] Prove terminal accepted callback increments run and attempt versions and writes two scoped events.
- [ ] Prove exact replay adds no versions/events and preserves original completion time.
- [ ] Prove stale run version and stale attempt version direct helper calls fail closed with no metadata/event changes.
- [ ] Prove a running callback maps an eligible attempt to `in_progress` and emits only changed-entity events.
- [ ] Prove an accepted no-attempt callback changes only the run.
- [ ] Prove conflicting terminal callback writes no new transition/result/child/audit state.
- [ ] Apply migrations 0001–0028 from scratch and verify replay has no pending migration.
- [ ] Commit as `test(core): prove guarded runner results`.

### Task 4: Full verification, PR, merge, and cleanup

- [ ] Run root lint/typecheck.
- [ ] Run fresh PostgreSQL full monorepo integration matrix and migration replay.
- [ ] Push through mandatory typecheck/unit/dist/package/security pre-push gates.
- [ ] Open `feat(core): guard runner result transitions`, relate to #23, and record exact counts.
- [ ] Require Dependency Review, self-smoke, lint-fast, security, and CI success.
- [ ] Squash merge and verify merge-SHA CI, security, docs, benchmark, and release-please.
- [ ] Update #23 with evidence and remaining lease/legacy writers.
- [ ] Fast-forward local main; remove feature worktree/branch and disposable PostgreSQL container.
