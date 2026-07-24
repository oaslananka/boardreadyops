# Control-plane Lifecycle Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and durably repair missing lifecycle jobs and webhook-inbox state drift without GitHub credentials or tenant payload logging.

**Architecture:** Extend the existing reconciliation table with a tenant-scoped `webhook_inbox` subject and dedicated detector/claim/apply SQL functions. Add typed store methods and a small worker processor, then wire a lifecycle-reconciliation loop that runs independently from workflow and Check Run clients. Completed reconciliation items provide existing audit and SLI accounting.

**Tech Stack:** PostgreSQL PL/pgSQL, TypeScript 6, Node.js 24, Vitest, pg integration tests, Next.js worker runtime.

## Global Constraints

- Use reason codes `lifecycle_job_missing` and `lifecycle_inbox_state_drift` exactly.
- Never log or copy normalized actions, webhook payloads, source, findings, credentials, or GitHub response bodies.
- Treat `control_plane_jobs.status` as authoritative whenever a job exists.
- Skip detection when an inbox cannot be resolved to an installation.
- Keep lifecycle reconciliation independent of GitHub App configuration.
- Preserve existing workflow and Check Run reconciliation behavior.

---

### Task 1: Add the lifecycle reconciliation migration

**Files:**
- Create: `packages/db/migrations/0022_control_plane_lifecycle_reconciliation.sql`
- Modify: `tests/unit/db/migrations.test.ts`
- Create: `tests/unit/db/control-plane-lifecycle-reconciliation-migration.test.ts`

**Interfaces:**
- Produces SQL functions:
  - `boardreadyops_detect_control_plane_lifecycle_reconciliation(timestamptz, integer, integer, integer) returns integer`
  - `boardreadyops_claim_control_plane_lifecycle_reconciliation(text, timestamptz, timestamptz, integer)`
  - `boardreadyops_apply_control_plane_lifecycle_reconciliation(text, text, timestamptz) returns text`

- [ ] **Step 1: Write failing migration contract tests**

Assert migration 22 exists, is ordered after migration 21, extends the reconciliation subject constraint with `webhook_inbox`, extends scope validation, uses `for update skip locked`, inserts the two exact reason codes, filters the dedicated claim function, and implements the four authoritative job-to-inbox projections.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
pnpm exec vitest run tests/unit/db/migrations.test.ts tests/unit/db/control-plane-lifecycle-reconciliation-migration.test.ts
```

Expected: failure because migration 22 and its SQL functions do not exist.

- [ ] **Step 3: Implement migration 22**

The detector must select bounded mismatches older than the observation cutoff, resolve installation/repository scope, and insert active reconciliation rows with:

```sql
case
  when cpj.id is null then 'webhook_inbox'
  else 'job'
end,
case
  when cpj.id is null then 'lifecycle_job_missing'
  else 'lifecycle_inbox_state_drift'
end
```

The apply function must lock the reconciliation item and subject rows, create a missing job using `gen_random_uuid()::text` and `provider || ':' || delivery_id`, or project job state onto the inbox. It must complete through `boardreadyops_complete_control_plane_reconciliation` so existing audit and SLI paths remain authoritative.

- [ ] **Step 4: Run migration tests**

Expected: all migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0022_control_plane_lifecycle_reconciliation.sql tests/unit/db/migrations.test.ts tests/unit/db/control-plane-lifecycle-reconciliation-migration.test.ts
git commit -m "feat(core): add lifecycle reconciliation migration"
```

### Task 2: Add typed database-store operations

**Files:**
- Modify: `packages/db/src/control-plane-operations-store.ts`
- Modify: `tests/unit/db/control-plane-operations-store.test.ts`
- Create: `tests/unit/db/control-plane-lifecycle-reconciliation-store.test.ts`

**Interfaces:**
- Extend `ControlPlaneReconciliationSubjectType` with `webhook_inbox`.
- Add:

```ts
detectLifecycleReconciliationCandidates(input: {
  observationDelaySeconds: number;
  terminalDeadlineSeconds: number;
  limit?: number;
}): Promise<number>;

claimLifecycleReconciliationItems(input: {
  workerId: string;
  limit?: number;
}): Promise<ClaimedControlPlaneReconciliationItem[]>;

applyLifecycleReconciliation(input: {
  reconciliationId: string;
  workerId: string;
}): Promise<"already_repaired" | "already_terminal" | "applied" | "stale">;
```

- [ ] **Step 1: Write failing unit tests**

Pin validation bounds, function names, timestamp/lease bindings, claim decoding, and apply-result mapping.

- [ ] **Step 2: Run focused store tests**

Expected: TypeScript/test failures because methods and subject type are missing.

- [ ] **Step 3: Implement minimal typed methods**

Reuse existing claim and detector helpers. Validate reconciliation and worker identifiers. Map unknown apply outcomes to `stale`.

- [ ] **Step 4: Run store tests and cloud typecheck**

```bash
pnpm exec vitest run tests/unit/db/control-plane-operations-store.test.ts tests/unit/db/control-plane-lifecycle-reconciliation-store.test.ts
pnpm run cloud:typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/control-plane-operations-store.ts tests/unit/db/control-plane-operations-store.test.ts tests/unit/db/control-plane-lifecycle-reconciliation-store.test.ts
git commit -m "feat(core): expose lifecycle reconciliation store"
```

### Task 3: Add the lifecycle reconciliation processor

**Files:**
- Create: `apps/web/lib/control-plane-lifecycle-reconciliation-worker.ts`
- Create: `tests/unit/web/control-plane-lifecycle-reconciliation-worker.test.ts`

**Interfaces:**

```ts
export type ControlPlaneLifecycleReconciliationResult = {
  reconciliationId: string;
  status: "already_repaired" | "already_terminal" | "applied" | "dead_letter" | "retry" | "stale";
  outcomeCode: string;
};

export async function processControlPlaneLifecycleReconciliation(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: {
    workerId: string;
    operations: ControlPlaneOperationsStore;
  },
): Promise<ControlPlaneLifecycleReconciliationResult>;
```

- [ ] **Step 1: Write failing processor tests**

Cover apply success/no-op/stale, database exception to retry, maximum-attempt exception to dead letter, and bounded error classification without including payload data.

- [ ] **Step 2: Run test and confirm failure**

- [ ] **Step 3: Implement processor**

Call `applyLifecycleReconciliation`; on error call the existing `failReconciliationItem` with the claimed attempt count and sanitized class/message. Return stable outcome codes.

- [ ] **Step 4: Run processor tests**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/control-plane-lifecycle-reconciliation-worker.ts tests/unit/web/control-plane-lifecycle-reconciliation-worker.test.ts
git commit -m "feat(core): process lifecycle reconciliation"
```

### Task 4: Wire independent detection, claiming, readiness, and logs

**Files:**
- Modify: `apps/web/worker.ts`
- Modify: `apps/web/lib/control-plane-worker-runtime.ts`
- Modify: `tests/unit/web/control-plane-worker-runtime.test.ts`
- Modify: `tests/unit/web/control-plane-worker.test.ts`

**Interfaces:**
- Add readiness fields:
  - `lastLifecycleReconciliationPollAt?: string`
  - `lastSuccessfulLifecycleReconciliationAt?: string`
- Add structured events:
  - `worker.lifecycle_reconciliation_detected`
  - `worker.lifecycle_reconciliation_detection_failed`
  - `worker.lifecycle_reconciliation_claim_failed`
  - `worker.lifecycle_reconciliation_terminal`

- [ ] **Step 1: Add failing source/runtime tests**

Assert lifecycle detection runs in maintenance, the claim loop runs without GitHub clients, readiness includes both timestamps, and logs contain only safe aggregate fields.

- [ ] **Step 2: Run focused tests and confirm failure**

- [ ] **Step 3: Implement worker wiring**

Create a dedicated lifecycle reconciliation loop. Keep the existing GitHub reconciliation loop conditional. Include lifecycle concurrency in the database-pool default and shutdown loop aggregation.

- [ ] **Step 4: Run focused tests and typecheck**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/worker.ts apps/web/lib/control-plane-worker-runtime.ts tests/unit/web/control-plane-worker-runtime.test.ts tests/unit/web/control-plane-worker.test.ts
git commit -m "feat(core): run lifecycle reconciliation"
```

### Task 5: Add PostgreSQL behavior coverage and operations documentation

**Files:**
- Create: `tests/integration/control-plane-lifecycle-reconciliation-postgres.test.ts`
- Modify: `docs/operations/control-plane-reconciliation.md`
- Modify: `docs/deployment/self-hosted.md`
- Modify: `tests/unit/docs/control-plane-operations-docs.test.ts`

**Interfaces:**
- Integration tests call the typed store against migrated PostgreSQL.

- [ ] **Step 1: Write integration tests**

Cover tenant-scoped detection, missing-job recreation, all four job-status projections, concurrent/no-op convergence, unresolved-installation skip, and `reconciliation_repairs_24h` increment.

- [ ] **Step 2: Run the integration test and fix SQL defects**

Run the repository's PostgreSQL integration harness for the new file. Expected: pass with no cross-tenant rows.

- [ ] **Step 3: Document detection and incident response**

Document reason codes, authoritative state table, readiness fields, logs, replay behavior, and the rule that operators never inspect normalized actions through telemetry.

- [ ] **Step 4: Run docs tests and strict docs build**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/control-plane-lifecycle-reconciliation-postgres.test.ts docs/operations/control-plane-reconciliation.md docs/deployment/self-hosted.md tests/unit/docs/control-plane-operations-docs.test.ts
git commit -m "docs(core): document lifecycle reconciliation"
```

### Task 6: Full verification and pull request

**Files:**
- Review all changed files.

- [ ] **Step 1: Run formatting, lint, Knip, and typecheck**
- [ ] **Step 2: Run focused and full unit suites**
- [ ] **Step 3: Run cloud coverage and PostgreSQL integration tests**
- [ ] **Step 4: Run strict docs and production cloud builds**
- [ ] **Step 5: Run `git diff --check` and the pre-push hook**
- [ ] **Step 6: Push the branch, open a PR referencing #190, and verify all CI checks**
- [ ] **Step 7: Merge only after every required and external quality check succeeds**
