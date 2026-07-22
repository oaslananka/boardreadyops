# Crash-Recoverable Control-Plane Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish issue #189 by adding scoped concurrency, complete safe log correlation, defensive redaction, bundle-boundary verification, and deployment/rollback guidance to the existing durable worker.

**Architecture:** Keep `apps/web/worker.ts` as the process entry point and extract testable runtime helpers into `apps/web/lib/control-plane-worker-runtime.ts`. Apply one shared installation/repository concurrency gate to lifecycle and outbox work, sanitize every structured log field, and verify the esbuild bundle cannot include KiCad/source-execution dependencies.

**Tech Stack:** TypeScript 6, Node.js 22/24, Vitest, esbuild, PostgreSQL-backed durable jobs/outbox, pnpm.

## Global Constraints

- Preserve the existing PostgreSQL job and outbox contracts.
- Do not add a queue, cache, or distributed rate-limit dependency.
- Do not log raw webhook payloads, source, findings, OIDC material, capabilities, tokens, or secrets.
- The worker remains orchestration-only and performs no KiCad execution or repository checkout.
- New configuration values must be validated as integers in the range `1..32`.

---

### Task 1: Runtime correlation and redaction

**Files:**
- Create: `apps/web/lib/control-plane-worker-runtime.ts`
- Create: `tests/unit/web/control-plane-worker-runtime.test.ts`

**Interfaces:**
- Produces: `jobCorrelation(job)`, `outboxCorrelation(effect)`, `sanitizeWorkerLogFields(fields)`, `workerScopeFromJob(job)`, and `workerScopeFromOutboxEffect(effect)`.

- [ ] **Step 1: Write failing tests**

Cover lifecycle job correlation, outbox correlation, nested sensitive-key redaction, bearer token redaction, credential assignment redaction, and bounded strings.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts`

Expected: FAIL because `control-plane-worker-runtime.ts` does not exist.

- [ ] **Step 3: Implement minimal helpers**

Use lifecycle action and outbox payload discriminants to extract only safe identifiers. Sanitize recursively, replacing sensitive values with `[REDACTED]`, and limit arbitrary strings to 2,000 characters.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(cloud): add worker correlation and redaction runtime`

### Task 2: Shared scoped concurrency gate

**Files:**
- Modify: `apps/web/lib/control-plane-worker-runtime.ts`
- Modify: `tests/unit/web/control-plane-worker-runtime.test.ts`

**Interfaces:**
- Produces: `createScopedConcurrencyGate({ installationLimit, repositoryLimit })` returning `{ run(scope, operation), snapshot() }`.

- [ ] **Step 1: Write failing concurrency tests**

Create deferred operations that prove no more than the configured number run concurrently for one installation or one repository, while unrelated repositories can progress.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts`

Expected: FAIL because the gate API is missing.

- [ ] **Step 3: Implement the gate**

Use FIFO keyed semaphores with `try/finally` release. Acquire installation scope before repository scope and release in reverse order. Delete idle semaphore entries.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(cloud): enforce scoped worker concurrency`

### Task 3: Wire runtime hardening into the worker

**Files:**
- Modify: `apps/web/worker.ts`
- Modify: `tests/unit/web/control-plane-worker-runtime.test.ts`
- Modify: `docs/deployment/self-hosted.md`

**Interfaces:**
- Consumes: runtime helpers and scoped gate from Tasks 1-2.

- [ ] **Step 1: Write failing integration-style unit assertions**

Add source-level tests that require both new environment variables, correlation helpers on terminal logs, and the sanitizer at the single `log()` serialization boundary.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts`

Expected: FAIL because `worker.ts` is not wired to the runtime helpers.

- [ ] **Step 3: Update the worker**

Add validated installation/repository concurrency variables, create one shared gate, wrap job/effect processing, include full safe correlation in terminal logs, sanitize all log fields, and expose scoped limits plus active/waiting counts in readiness output.

- [ ] **Step 4: Update deployment documentation**

Document defaults, scaling implications, readiness withdrawal, rolling deploy order, and application-first rollback with lease expiry.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts tests/unit/web/control-plane-worker.test.ts tests/unit/web/control-plane-outbox-worker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(cloud): harden worker runtime controls`

### Task 4: Enforce the orchestration-only bundle boundary

**Files:**
- Create: `scripts/verify-control-plane-worker-boundary.mjs`
- Create: `tests/unit/scripts/verify-control-plane-worker-boundary.test.ts`
- Modify: `scripts/build-control-plane-worker.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `verifyControlPlaneWorkerBoundary(metafile)` and CLI verification of `apps/web/.next/worker-meta.json`.

- [ ] **Step 1: Write failing verifier tests**

Use synthetic esbuild metafiles. One allowed graph must pass. Graphs containing KiCad execution, command execution, repository checkout, or source-workspace modules must fail with the offending input path.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/scripts/verify-control-plane-worker-boundary.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement verifier and build metadata**

Export the verifier from the script, guard CLI execution with `import.meta.url`, enable `metafile: true` in the worker build, write deterministic JSON, and run the verifier after bundling.

- [ ] **Step 4: Add package command**

Add `verify:control-plane-worker-boundary` and include it in `cloud:build` after the web standalone verification.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/scripts/verify-control-plane-worker-boundary.test.ts && pnpm run cloud:build`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `build(cloud): verify worker execution boundary`

### Task 5: Final verification and PR completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-22-crash-recoverable-worker.md`
- Modify: issue #189 and the pull request description.

- [ ] **Step 1: Run focused verification**

Run: `pnpm exec vitest run tests/unit/web/control-plane-worker-runtime.test.ts tests/unit/web/control-plane-worker.test.ts tests/unit/web/control-plane-outbox-worker.test.ts tests/unit/scripts/verify-control-plane-worker-boundary.test.ts`

Expected: PASS.

- [ ] **Step 2: Run repository gates**

Run: `pnpm run lint && pnpm run typecheck && pnpm run cloud:build && pnpm run test:unit`

Expected: PASS.

- [ ] **Step 3: Review all bot and agent feedback**

Check PR comments, submitted reviews, inline review threads, SonarQube Cloud, Codecov, DeepScan, CodeQL, Semgrep, Gitleaks, OSV, Dependency Review, and SBOM results. Resolve every actionable finding before merge.

- [ ] **Step 4: Update plan checkboxes and PR verification section**

Record exact passing gates and any intentionally deferred scope.

- [ ] **Step 5: Merge and close**

Squash merge only after all required checks pass. Close issue #189 as completed with links to the merged PR and deployment documentation.
