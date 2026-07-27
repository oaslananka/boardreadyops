# Guarded Release-Run Supersession Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move webhook-driven previous-run supersession onto versioned, append-only transition semantics while preserving transactional enqueue/outbox idempotency and ensuring concurrent different-commit enqueues leave exactly one active run.

**Architecture:** Schema v27 adds a dedicated `boardreadyops_supersede_release_run_state` PostgreSQL helper because one logical run can contain more than one nonterminal attempt and the general v23 transition function is intentionally limited to the current attempt. The enqueue producer resolves tenant/repository scope, takes a transaction-scoped repo/PR advisory lock, snapshots each active different-commit run, calls the helper with expected run status/version/current-attempt identity, and inserts the new run and Check Run outbox effect in the same transaction. The helper locks the run and all nonterminal attempts, increments every changed entity version exactly once, preserves failure metadata, and writes one append-only event per changed entity.

**Tech Stack:** PostgreSQL 17 PL/pgSQL, TypeScript 6, pnpm 11, Vitest 4, existing BoardReadyOps migration runner and transactional lifecycle store.

## Global Constraints

- Use the approved `docs/superpowers/specs/2026-07-27-versioned-run-transitions-design.md` contract.
- Do not change the TypeScript lifecycle-store public API.
- Preserve release-run and Check Run outbox idempotency keys exactly.
- Same-commit replay must create no transition events and must return the original run/outbox IDs.
- Different-commit enqueue must supersede all active prior runs for the same repository and pull request.
- Every changed run or attempt increments `version` by exactly one and receives exactly one append-only transition event.
- Supersession reason code is `newer_commit`.
- Attempt failure metadata remains `failure_class = newer_commit` and `failure_message = A newer commit superseded this execution attempt.` when those fields were previously null.
- No source, findings, artifacts, workflow payloads, credentials, or raw errors may be copied into transition events.
- Keep the pre-existing 12 PostgreSQL fixture lint warnings unchanged; introduce no new lint warnings.

---

### Task 1: Define the schema v27 supersession contract

**Files:**
- Create: `tests/unit/db/guarded-release-run-supersession-migration.test.ts`
- Create: `packages/db/migrations/0027_guarded_release_run_supersession.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`
- Modify: `tests/unit/db/transactional-release-run-outbox-migration.test.ts`

**Interfaces:**
- Consumes: `boardreadyops_release_run_transition_allowed(text, text)`, `boardreadyops_release_run_attempt_transition_allowed(text, text)`, and `release_run_transition_events` from schema v23.
- Produces: `boardreadyops_supersede_release_run_state(p_release_run_id text, p_expected_run_status text, p_expected_run_version bigint, p_expected_execution_attempt_id text, p_reason_code text, p_now timestamptz)` returning `transition_outcome text`, `run_status text`, `run_version bigint`, and `superseded_attempt_count integer`.
- Replaces: `boardreadyops_enqueue_release_run_with_outbox(...)` with the same signature and return columns.

- [ ] **Step 1: Write the failing migration contract test**

Create assertions that require:

```ts
expect(cloudDatabaseSchemaVersion).toBe(27);
expect(sql).toContain("create or replace function boardreadyops_supersede_release_run_state");
expect(sql).toContain("pg_advisory_xact_lock");
expect(sql).toContain("boardreadyops_supersede_release_run_state(");
expect(sql).not.toContain("with superseded_runs as (\n    update release_runs");
```

Also assert that the helper:

- checks expected run status, version, and current-attempt identity before writes;
- locks nonterminal attempts in deterministic `attempt_number, id` order;
- increments run and attempt versions;
- writes `release_run` and `execution_attempt` transition events with `newer_commit`;
- updates attempt terminal/failure metadata;
- returns `stale`, `not_found`, `invalid_transition`, or `applied` outcomes;
- leaves the enqueue function signature and outbox idempotency format unchanged.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm exec vitest run \
  tests/unit/db/guarded-release-run-supersession-migration.test.ts \
  tests/unit/db/migrations.test.ts \
  tests/unit/db/transactional-release-run-outbox-migration.test.ts
```

Expected: failure because schema version remains 26 and migration `0027_guarded_release_run_supersession.sql` does not exist.

- [ ] **Step 3: Implement the minimal schema v27 migration**

The helper must:

1. lock the target `release_runs` row;
2. return `not_found` when absent;
3. compare status/version/current-attempt identity against the expected snapshot and return `stale` without writes on mismatch;
4. validate `newer_commit` through the existing bounded reason-code format and validate the run edge to `superseded`;
5. materialize and lock all nonterminal attempts ordered by `attempt_number, id`;
6. reject an invalid attempt edge before any update;
7. update each attempt to `superseded`, increment version, set terminal/failure metadata, and insert an append-only attempt transition event;
8. update the run to `superseded`, increment version, set terminal duration, and insert an append-only run transition event;
9. return `applied` plus the new run version and changed-attempt count.

The enqueue replacement must:

1. resolve and lock the tenant-scoped repository row;
2. take `pg_advisory_xact_lock(hashtextextended(repository_id || ':' || pull_request_number, 0))` before reading active runs;
3. iterate active different-commit runs in deterministic `started_at, id` order;
4. call the helper with the row snapshot and raise SQLSTATE `40001` unless it returns `applied`;
5. retain the existing new-run insert, same-commit conflict behavior, outbox insert, payload rewrite, and return shape.

- [ ] **Step 4: Run focused tests and DB package typecheck**

Run:

```bash
pnpm exec vitest run \
  tests/unit/db/guarded-release-run-supersession-migration.test.ts \
  tests/unit/db/migrations.test.ts \
  tests/unit/db/transactional-release-run-outbox-migration.test.ts
pnpm --filter @boardreadyops/db typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit the migration slice**

```bash
git add packages/db/migrations/0027_guarded_release_run_supersession.sql \
  packages/db/src/index.ts \
  tests/unit/db/guarded-release-run-supersession-migration.test.ts \
  tests/unit/db/migrations.test.ts \
  tests/unit/db/transactional-release-run-outbox-migration.test.ts
git commit -m "feat(core): guard release-run supersession"
```

### Task 2: Prove transactional and concurrency behavior in PostgreSQL

**Files:**
- Modify: `tests/integration/transactional-release-run-outbox-postgres.test.ts`

**Interfaces:**
- Consumes: unchanged `createSqlTransactionalGitHubAppLifecycleStore(...).enqueueReleaseRunWithOutbox(action)` API.
- Produces: PostgreSQL evidence for version/event increments, multi-attempt cleanup, idempotent replay, and serialized concurrent enqueues.

- [ ] **Step 1: Add failing PostgreSQL adversarial tests**

Add real-database cases that prove:

1. a queued run without an attempt becomes `superseded`, version `1`, with one run event;
2. a run with a current nonterminal attempt supersedes both entities, increments both versions, and writes exactly two events;
3. a run with multiple nonterminal attempts supersedes every attempt and writes one event per attempt while retaining the current-attempt pointer for historical identity;
4. same-commit replay returns the original run/outbox and writes no supersession events;
5. two concurrent different-commit enqueues for the same repo/PR leave exactly one active run, one superseded run, and no active nonterminal attempts attached to the superseded run;
6. concurrent different-commit completion preserves one Check Run creation outbox row per logical run and keeps each payload bound to its own run ID;
7. transition events remain tenant/repository scoped and contain only state/version/reason dimensions.

Name the production change each test protects in the test title.

- [ ] **Step 2: Run against a fresh PostgreSQL 17 database and verify RED**

Start an isolated loopback-only PostgreSQL 17 container, apply migrations 0001–0026, then run:

```bash
BOARDREADYOPS_TEST_POSTGRES=1 \
DATABASE_URL="$DATABASE_URL" \
pnpm exec vitest run tests/integration/transactional-release-run-outbox-postgres.test.ts
```

Expected: new assertions fail because supersession still changes no versions/events and concurrent different-commit enqueue is not serialized.

- [ ] **Step 3: Apply migration 0027 and make only test-driven corrections**

Apply all migrations from scratch. Correct PL/pgSQL row-shape, locking, event, or concurrency behavior only when a failing PostgreSQL assertion demonstrates the defect. Do not change the TypeScript API or unrelated lifecycle paths.

- [ ] **Step 4: Verify focused PostgreSQL GREEN and migration replay**

Run the focused integration test, then run the migration command again.

Expected:

- every focused PostgreSQL test passes;
- second migration application reports no pending migrations;
- no duplicate transition events are produced by replay.

- [ ] **Step 5: Commit the PostgreSQL proof slice**

```bash
git add tests/integration/transactional-release-run-outbox-postgres.test.ts
git commit -m "test(core): prove guarded run supersession"
```

### Task 3: Full verification, PR, merge, and cleanup

**Files:**
- Verify only; modify no production files unless a failing test identifies a defect in this slice.

**Interfaces:**
- Consumes: clean feature HEAD with schema v27 and PostgreSQL proof.
- Produces: merged `main`, issue #23 evidence, and no leftover branch/worktree/container.

- [ ] **Step 1: Run root static checks**

```bash
pnpm run lint
pnpm run typecheck
```

Expected: success with only the existing 12 PostgreSQL test warnings.

- [ ] **Step 2: Run migration replay and full integration matrix**

Using a fresh PostgreSQL 17 container:

```bash
DATABASE_URL="$DATABASE_URL" node packages/db/scripts/apply-migrations.mjs
BOARDREADYOPS_TEST_POSTGRES=1 DATABASE_URL="$DATABASE_URL" pnpm run test:int:monorepo
```

Expected:

- migrations 0001–0027 apply from scratch;
- replay reports no pending migrations;
- required general integration and all explicit PostgreSQL files pass.

- [ ] **Step 3: Push through mandatory pre-push gates**

```bash
PATH="/tmp/boardreadyops-docs-venv-feat190/bin:$PATH" \
PRE_COMMIT_HOME=/tmp/boardreadyops-pre-commit-v27 \
git push -u origin feat/guard-release-run-supersession
```

Expected: root typecheck, all unit tests, dist reproducibility, bundle/npm budgets, and pre-commit security hooks pass.

- [ ] **Step 4: Open and validate the PR**

Open a non-draft PR titled `feat(core): guard release-run supersession`, relate it to #23, and include exact test counts and migration evidence. Wait for Dependency Review, self-smoke, lint-fast, security, and CI to succeed.

- [ ] **Step 5: Squash merge and verify `main`**

Squash merge only when the PR is clean and every required check is green. Verify CI, security, docs, benchmark, and release-please on the merge SHA.

- [ ] **Step 6: Update #23 and clean local resources**

Record the merge SHA, schema v27 behavior, exact verification counts, and remaining direct writers. Fast-forward local `main`, remove the feature worktree and branch, remove the disposable PostgreSQL container, and confirm `main == origin/main` with a clean tree.
