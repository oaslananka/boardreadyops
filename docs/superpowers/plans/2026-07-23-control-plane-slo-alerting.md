# Control-plane SLO Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate existing privacy-safe control-plane SLI snapshots against a versioned GitHub Cloud GA policy and emit transition-only alert logs.

**Architecture:** A stateful in-process evaluator owns debounce and recovery state for aggregate signals. The worker calls it only after successful SLI collection, logs one evaluation summary plus firing/recovery transitions, and leaves readiness unchanged.

**Tech Stack:** TypeScript, Vitest, Next.js worker bundle, MkDocs.

## Global Constraints

- Policy version is exactly `github-cloud-ga-v1`.
- Never include tenant identifiers, payloads, source, findings, artifacts, credentials, or tokens.
- SLI or SLO evaluation failure must not affect readiness or queue processing.
- Emit transition events only; do not repeat firing events on every snapshot.

---

### Task 1: Add the SLO evaluator

**Files:**
- Create: `apps/web/lib/control-plane-slo.ts`
- Create: `tests/unit/web/control-plane-slo.test.ts`

**Interfaces:**
- Consumes: `ControlPlaneSliSnapshot` from `@boardreadyops/db/control-plane-operations-store`.
- Produces: `createControlPlaneSloEvaluator()` with `evaluate(snapshot, observedAt?)` returning policy version, health, active signals, and transition events.

- [ ] Write failing tests for healthy snapshots, sustained queue breach, stale-attempt consecutive samples, increasing backlog, terminal minimum volume, and recovery.
- [ ] Run `pnpm exec vitest run tests/unit/web/control-plane-slo.test.ts` and confirm RED.
- [ ] Implement the minimal evaluator with versioned thresholds and in-memory state.
- [ ] Run the focused test and confirm GREEN.
- [ ] Commit `feat(cloud): evaluate control-plane SLO alerts`.

### Task 2: Wire transition logging into the worker

**Files:**
- Modify: `apps/web/worker.ts`
- Modify: `tests/unit/web/control-plane-worker-runtime.test.ts`

**Interfaces:**
- Consumes: `createControlPlaneSloEvaluator()` from Task 1.
- Produces: `worker.control_plane_slo_evaluation`, `worker.control_plane_slo_firing`, and `worker.control_plane_slo_recovered` events.

- [ ] Add failing source-wiring assertions for evaluator construction, evaluation after a successful snapshot, and all three event names.
- [ ] Run the worker runtime test and confirm RED.
- [ ] Instantiate one evaluator and emit bounded transition logs from `collectQueueMetrics`.
- [ ] Run worker tests and cloud typecheck and confirm GREEN.
- [ ] Commit `feat(cloud): emit control-plane SLO transitions`.

### Task 3: Document and verify the GA policy

**Files:**
- Modify: `docs/deployment/self-hosted.md`
- Modify: `docs/operations/control-plane-reconciliation.md`
- Modify: `tests/unit/docs/control-plane-operations-docs.test.ts`

**Interfaces:**
- Consumes: the exact policy and event names from Tasks 1 and 2.
- Produces: operator guidance for firing, recovery, escalation, and restart semantics.

- [ ] Add failing documentation assertions for policy version, event names, thresholds, transition-only behavior, and readiness independence.
- [ ] Run the docs test and confirm RED.
- [ ] Replace observation-only wording with the formal initial policy and add an incident response section.
- [ ] Run docs tests and strict docs build and confirm GREEN.
- [ ] Commit `docs(cloud): define initial control-plane SLO policy`.

### Task 4: Final verification

**Files:**
- Verify all modified files.

- [ ] Run focused SLO, worker, operations-store, and docs tests.
- [ ] Run `pnpm run cloud:typecheck`.
- [ ] Run `pnpm run cloud:build`.
- [ ] Run `pnpm run lint`.
- [ ] Inspect `git diff --check` and `git status --short`.
