# Guarded Runner Lease Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Move managed and self-hosted runner lease claim, heartbeat, relinquish, and expiry lifecycle mutations onto optimistic-concurrency guards with append-only transition evidence while preserving the existing runner protocol.

**Architecture:** Schema v29 binds every runner lease to the authoritative run and attempt status/version snapshot that the lease owns. The existing PostgreSQL lease functions keep their public signatures, but lock and validate the run, attempt, and lease before lifecycle writes; accepted status changes increment the affected entity version exactly once and append tenant-scoped transition events. Lease heartbeat metadata may advance without a lifecycle event when the attempt status is unchanged.

**Tech Stack:** PostgreSQL 17 PL/pgSQL, TypeScript 6, pnpm 11, Vitest 4.

## Global Constraints

- Preserve runner protocol v1 request and response contracts.
- Preserve managed/self-hosted eligibility, tenant isolation, capability routing, nonce replay protection, lease token validation, safe-mode metadata, and audit events.
- Bind active leases to expected run status/version and expected attempt status/version.
- Use the existing current-attempt pointer as part of every accepted lifecycle mutation.
- Claim creates a version-zero attempt, increments the logical run version once for the new authoritative pointer, and writes one run transition event.
- Heartbeat increments the attempt version and writes an event only when the mapped attempt status changes.
- Relinquish and expiry transition the current attempt and logical run atomically, update both versions, and write one event per changed entity.
- Lifecycle drift fails closed without mutating the authoritative run or attempt.
- An expired lease may still be closed when its lifecycle binding is stale, but it must not modify a newer run/attempt state.
- Extend the formal run graph only for the existing bounded-retry edge `running -> queued`.
- Introduce no new lint warnings beyond the existing 12 PostgreSQL fixture warnings.

### Task 1: Define schema v29 lease bindings and guarded functions

**Files:**
- Create: `packages/db/migrations/0029_guarded_runner_lease_transitions.sql`
- Create: `tests/unit/db/guarded-runner-lease-transitions-migration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`

- [ ] Write RED tests requiring schema 29, four immutable lease snapshot columns, the `running -> queued` retry edge, and replacements for claim, heartbeat, relinquish, and expiry.
- [ ] Verify RED because migration 0029 and schema export are absent.
- [ ] Add and safely backfill expected run/attempt status/version columns on `runner_job_leases`.
- [ ] Replace `boardreadyops_claim_runner_job(...)` without changing its signature or result columns.
- [ ] Replace `boardreadyops_heartbeat_runner_lease(...)` without changing its signature or result columns.
- [ ] Replace `boardreadyops_relinquish_runner_lease(...)` without changing its signature or result value.
- [ ] Replace `boardreadyops_expire_runner_leases(...)` without changing its signature or count semantics.
- [ ] Add version guards, current-attempt validation, conditional version increments, transition events, and stable reason codes.
- [ ] Run focused migration tests and DB package typecheck.
- [ ] Commit as `feat(core): guard runner lease transitions`.

### Task 2: Prove real PostgreSQL behavior

**Files:**
- Modify: `tests/integration/runner-lease-store-postgres.test.ts`

- [ ] Prove concurrent claim still yields one lease and one attempt, with run version 1 and one `runner_lease_claimed` event.
- [ ] Prove expiry marks the old attempt stale, requeues and versions the run, emits two expiry events, and permits a new version-bound claim.
- [ ] Prove heartbeat status progression versions only the attempt and updates the lease snapshot.
- [ ] Prove same-status heartbeat updates metadata without a version or transition event.
- [ ] Prove relinquish versions the attempt and run, closes the lease, and preserves nonce replay behavior.
- [ ] Prove stale run version, stale attempt version, and current-attempt pointer drift fail closed.
- [ ] Prove stale-binding expiry closes only the obsolete lease and leaves newer lifecycle state untouched.
- [ ] Apply migrations 0001–0029 from scratch and verify replay has no pending migration.
- [ ] Commit as `test(core): prove guarded runner leases`.

### Task 3: Document the enforced lifecycle contract

**Files:**
- Modify: `docs/product/run-lifecycle.md`

- [ ] Document lease snapshot binding, claim pointer versioning, heartbeat status progression, and bounded retry through relinquish/expiry.
- [ ] State that stale lease bindings cannot mutate authoritative lifecycle state.
- [ ] Run the focused docs contract test and strict docs build.
- [ ] Commit as `docs(core): document guarded runner leases`.

### Task 4: Full verification, PR, merge, and cleanup

- [ ] Run root lint and typecheck.
- [ ] Run migrations 0001–0029 and the full monorepo PostgreSQL integration matrix on a fresh PostgreSQL 17 database.
- [ ] Push through mandatory typecheck, unit, dist reproducibility, package budget, and security hooks.
- [ ] Open a single-purpose PR related to #23 with exact validation evidence, security impact, and rollback notes.
- [ ] Require Dependency Review, self-smoke, lint-fast, security, and CI success.
- [ ] Squash merge and verify merge-SHA CI, security, docs, benchmark, and release-please.
- [ ] Update #23 with evidence and the remaining legacy-store/closure audit scope.
- [ ] Fast-forward local main and remove the feature worktree, branch, and disposable PostgreSQL container.
