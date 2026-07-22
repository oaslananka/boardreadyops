# Reconciliation Operations Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped, audited dead-letter operations, a durable reconciliation queue, and privacy-safe control-plane SLIs as the first implementation slice of issue #190.

**Architecture:** Add one additive PostgreSQL migration and a focused `ControlPlaneOperationsStore`. Keep payload-bearing job/outbox stores unchanged; operator reads return only safe metadata. Atomic SQL functions enforce installation scope, replay safety, operation idempotency, lease ownership, and append-only audit events.

**Tech Stack:** PostgreSQL, TypeScript 6, Node.js 22/24, Vitest, pnpm.

## Global constraints

- Never return `normalized_actions`, outbox `payload`, repository source, findings, OIDC material, signed capabilities, tokens, or secrets.
- Require internal installation ID for every list or mutation.
- Never replay `reconciliation_required` workflow dispatches.
- Replay must preserve existing idempotency keys and be idempotent by operation ID.
- All public reason codes must be stable lowercase identifiers.
- Schema changes are additive and forward-compatible.

---

### Task 1: Specify the operations store

**Files:**
- Create: `tests/unit/db/control-plane-operations-store.test.ts`
- Create: `packages/db/src/control-plane-operations-store.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 1: Write failing unit tests**

Cover tenant-scoped dead-letter listing, row decoding without payload fields, job/outbox replay calls, reconciliation claim decoding, SLI snapshot decoding, and invalid installation/operation identifiers.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/db/control-plane-operations-store.test.ts`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement minimal store contracts**

Define safe dead-letter item, reconciliation item, replay result, reconciliation result, and SLI snapshot types. Validate identifiers, clamp limits, and call migration-backed SQL functions.

- [ ] **Step 4: Export the module**

Add `./control-plane-operations-store` to `packages/db/package.json` exports.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/db/control-plane-operations-store.test.ts`

Expected: PASS.

### Task 2: Add migration-backed operations

**Files:**
- Create: `packages/db/migrations/0019_control_plane_reconciliation_operations.sql`
- Create: `tests/unit/db/control-plane-reconciliation-migration.test.ts`

- [ ] **Step 1: Write failing migration assertions**

Assert the reconciliation and replay-operation tables, tenant-scope constraints, claim/replay functions, audit inserts, replay exclusion for `reconciliation_required`, and SLI function.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/db/control-plane-reconciliation-migration.test.ts`

Expected: FAIL because migration 0019 does not exist.

- [ ] **Step 3: Implement additive migration**

Create tables, indexes, validation constraints, and SQL functions for list, replay, enqueue, claim, complete, fail, and SLI snapshot operations.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/db/control-plane-reconciliation-migration.test.ts`

Expected: PASS.

### Task 3: Prove tenant isolation and idempotency in PostgreSQL

**Files:**
- Create: `tests/integration/control-plane-operations-postgres.test.ts`

- [ ] **Step 1: Write integration scenarios**

Create two installations and repositories. Prove scoped listing, cross-tenant replay denial, idempotent repeated operation IDs, audited replay, reconciliation-required non-replayability, lease expiry, and content-free SLI output.

- [ ] **Step 2: Run focused integration test**

Run: `pnpm exec vitest run tests/integration/control-plane-operations-postgres.test.ts --no-file-parallelism`

Expected: PASS against the standard CI PostgreSQL service.

### Task 4: Integrate SLI collection into the worker

**Files:**
- Modify: `apps/web/worker.ts`
- Modify: `tests/unit/web/control-plane-worker-runtime.test.ts`
- Modify: `docs/deployment/self-hosted.md`

- [ ] **Step 1: Add source-level assertions**

Require creation of the operations store and periodic `worker.control_plane_sli` structured logs containing only aggregate fields.

- [ ] **Step 2: Wire SLI collection**

Collect global content-free metrics in the existing maintenance loop. Failures remain non-fatal and emit error class only.

- [ ] **Step 3: Document metric semantics**

Document each SLI, initial observation thresholds, and privacy guarantees. Formal SLO alerting remains a later slice.

- [ ] **Step 4: Verify focused worker tests**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts tests/unit/db/control-plane-operations-store.test.ts`

Expected: PASS.

### Task 5: Final verification and draft PR

- [ ] **Step 1: Run repository gates**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test:unit && pnpm run cloud:build`

Expected: PASS.

- [ ] **Step 2: Open a draft PR**

Describe this as the foundation slice of #190 and do not close the issue yet.

- [ ] **Step 3: Review bot and agent feedback**

Inspect SonarQube Cloud, Codecov, DeepScan, CodeQL, Semgrep, Gitleaks, OSV, Dependency Review, SBOM, reviews, and inline threads. Resolve every actionable finding before merge.

## Slice boundary

This PR completes the database/store foundation and PostgreSQL verification in Tasks 1–3. Task 4 remains the next convergence-worker slice under issue #190, after these contracts are merged and stable.
