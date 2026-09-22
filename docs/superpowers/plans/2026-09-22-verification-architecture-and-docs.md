# Verification, Architecture, and Documentation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift confidence from volume metrics and hand-maintained status prose to executable invariants, typed capability contracts, focused modules, and generated documentation truth.

**Architecture:** Add a risk-invariant verification matrix first, then replace source-text reachability checks with a typed capability registry. Refactor only oversized modules touched by trust work, separate trust-core contracts from hosted-product breadth, and generate duplicated docs/status views from canonical machine-readable data.

**Tech Stack:** TypeScript, Vitest, integration fixtures, PostgreSQL, KiCad test environments, MkDocs/docs generation, repository structure/GC checks.

**Spec:** `docs/superpowers/specs/2026-09-22-assurance-hardening-program-design.md`

## Global Constraints

- Coverage percentage remains useful but cannot substitute for trust-invariant tests.
- Production reachability is proved through executable contracts/E2E, not string grep alone.
- Refactors preserve public behavior and stable schemas unless explicitly versioned.
- Generated views have one canonical source.
- Roadmap phase numbers are not product semver.
- Feature "done" requires reachability, tests, docs, operations, and rollback evidence.

## Review Focus

- A new protected capability with no producer/caller must fail reachability validation.
- A high-coverage module with an untested authorization invariant must remain incomplete.
- Pipeline/route decomposition must not change finding fingerprints or API response contracts.
- Generated changelog/status views must be byte-idempotent.
- An issue marked complete must correspond to shipped/reachable behavior.

---

### Task D1: Add a risk-invariant verification matrix

**Files:**
- Create: `docs/testing-risk-matrix.json` or equivalent canonical data
- Create/extend: `tests/unit/quality/trust-invariants.test.ts`
- Modify: `docs/testing.md`
- Modify: verification scripts

**Interfaces:**
- Canonical matrix records subsystem and required test classes: unit, integration, adversarial, E2E, property, release.
- CI fails if a critical subsystem loses its required invariant test mapping.

- [ ] **Step 1: Seed critical subsystems**: auth, tenant isolation, cloud upload, evidence, provenance, runner, release signing, migrations.
- [ ] **Step 2: Write RED quality test** requiring named executable tests/commands for each critical invariant.
- [ ] **Step 3: Link existing tests first**; add missing tests through the owning workstream rather than fake placeholders.
- [ ] **Step 4: Render a human-readable table in `docs/testing.md` from the canonical matrix.
- [ ] **Step 5: Commit `test(repo): codify trust invariant coverage`.

### Task D2: Replace source-text capability reachability with typed contracts

**Files:**
- Create: `packages/cloud-core/src/capabilities.ts` or closest shared contracts location
- Modify: CLI command registration
- Modify: web repository action registration
- Modify: notification/event producer registry
- Modify: `tests/unit/quality/capability-reachability.test.ts`
- Modify: capability/current-state docs generator

**Interfaces:**
- Typed capability entry includes:
```ts
interface CapabilityDefinition {
  id: string;
  maturity: "supported" | "experimental" | "planned" | "unsupported";
  entrypoints: readonly string[];
  producers?: readonly string[];
  permissions?: readonly string[];
  docs?: readonly string[];
}
```
- User-visible registration derives from or references the registry; tests execute registration, not source text.

- [ ] **Step 1: Write RED tests** for an intentionally unreachable fixture capability and for a capability with missing producer.
- [ ] **Step 2: Introduce the typed registry** for currently public capabilities.
- [ ] **Step 3: Migrate the existing source-grep quality test** to import/execute registries and route/command registration.
- [ ] **Step 4: Keep an AST/text scan only as a secondary drift detector**, never as proof of behavioral reachability.
- [ ] **Step 5: Generate current-state capability tables** from the registry.
- [ ] **Step 6: Commit `refactor(core): make capability reachability executable`.

### Task D3: Decompose oversized trust-critical modules when touched

**Files:**
- Candidate: `apps/web/app/api/v1/runs/result/route.ts`
- Candidate: `src/core/pipeline.ts`
- Candidate: `apps/web/worker.ts`
- Candidate: `packages/db/src/control-plane-operations-store.ts`
- Tests: existing route/pipeline/worker/store suites

**Interfaces:**
- API route layers: validation → auth → authorization → domain service → persistence/effects → response.
- Pipeline phases: discover → parse → analyze/rules → post-process → gate → report.

- [ ] **Step 1: Before each refactor, add characterization tests** for response/finding/state-transition contracts.
- [ ] **Step 2: Extract one responsibility at a time** into a focused module with typed input/output.
- [ ] **Step 3: Keep side effects at edges**; pure phases must not import higher runtime layers.
- [ ] **Step 4: Run `verify:structure` and focused tests after each extraction.**
- [ ] **Step 5: Stop when the trust change is auditable**; do not rewrite large UI modules unrelated to the program.
- [ ] **Step 6: Commit each independently reviewable extraction under `refactor(...)`.

### Task D4: Separate trust-core contracts from hosted-product release velocity

**Files:**
- Review/modify package boundaries under `src/`, `packages/cloud-core`, `packages/db`, plugin SDK, and web
- Modify: architecture docs/ADR
- Test: structure/import boundary tests

**Interfaces:**
- Trust core owns source/export/parse/validate/decision/evidence/sign/verify contracts.
- Hosted services consume those contracts and may release faster without redefining them.

- [ ] **Step 1: Write an ADR** defining trust-core public contracts and allowed dependency direction.
- [ ] **Step 2: Add/extend structure tests** that prevent hosted UI/billing/marketplace modules from becoming dependencies of core validation.
- [ ] **Step 3: Define compatibility/versioning policy** for `core`, contracts, plugin SDK, cloud-core, and web/control-plane.
- [ ] **Step 4: Move code only where an actual dependency violation or program change requires it; avoid package churn for aesthetics.
- [ ] **Step 5: Commit `docs(architecture): define trust-core release boundary`.

### Task D5: Create canonical documentation sources and remove duplicate hand-maintenance

**Files:**
- Create: machine-readable repository/product metadata source
- Modify: docs generation scripts
- Modify: `CHANGELOG.md` / `docs/release/history.md` generation relationship
- Modify: `docs/development/master-execution-status.json`
- Generate: `docs/development/master-execution-status.md`
- Archive/split oversized development plans where appropriate
- Tests: docs idempotency/drift tests

**Interfaces:**
- Canonical metadata includes current version, immutable Action SHA, supported Node/KiCad versions, license wording, upload modes, external-network capability, release channel.
- Markdown views are generated, not independently edited.

- [ ] **Step 1: Add RED docs drift tests** for version/SHA/license/upload-mode duplication.
- [ ] **Step 2: Make one machine-readable source canonical** and update docs generators to consume it.
- [ ] **Step 3: Choose one changelog/history source**; generate the other view or remove duplicate committed content if navigation permits.
- [ ] **Step 4: Keep execution status JSON canonical** and generate Markdown from it.
- [ ] **Step 5: Split/archive oversized historical plan transcripts** so durable docs contain decisions/current plans rather than execution logs.
- [ ] **Step 6: Run docs generation twice and require a clean tree.**
- [ ] **Step 7: Commit `docs: consolidate generated project truth`.

### Task D6: Correct licensing, roadmap naming, and issue/release state

**Files:**
- Modify: `SUPPORT.md`
- Modify: `TERMS.md`
- Modify: `PRIVACY.md`
- Modify: GTM/pricing/ICP/repo-maturity docs containing open-source/MIT claims
- Modify: roadmap/master execution status naming
- Update: GitHub issues whose implementation status is stale

**Interfaces:**
- Canonical licensing wording:
```text
Source-available under PolyForm Noncommercial 1.0.0.
Commercial use requires a separate commercial license.
```
- Internal roadmap uses Phase/Epic/Program identifiers, not release-looking `v2.x` labels unless they are real product semver.

- [ ] **Step 1: Add a content-policy RED test** rejecting `MIT license`, `100% open source`, or equivalent OSI claims for the PolyForm-licensed core.
- [ ] **Step 2: Replace inconsistent licensing language** across public/GTM docs.
- [ ] **Step 3: Rename roadmap-only `v2.x` milestones** to `Phase 2.x` or stable epic identifiers while preserving history.
- [ ] **Step 4: Reconcile open issues such as manufacturing/provenance trackers** against current code: close only with regression/acceptance evidence; otherwise edit completion claims to partial.
- [ ] **Step 5: Commit `docs: reconcile product and roadmap claims`.

### Task D7: Make definition-of-done and release evidence explicit

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: governance/release docs
- Modify: PR template
- Add/modify: quality policy test if feasible

**Interfaces:**
- A non-trivial capability is done only when code, unit/integration/E2E reachability, docs, security review, operations/telemetry, rollback, and release contract are addressed or explicitly marked not applicable.

- [ ] **Step 1: Add the definition-of-done checklist** to contributor/PR guidance without duplicating generated status data.
- [ ] **Step 2: Require implementation PRs to link their design/plan** for cross-cutting work.
- [ ] **Step 3: Require production acceptance evidence** for claims such as setup/release automation reachability.
- [ ] **Step 4: Add stabilization/release reconciliation**: after merge, issue/current-state/release notes must match shipped behavior.
- [ ] **Step 5: Run docs, GC/knip, structure, and full repository validation.**
- [ ] **Step 6: Commit `docs(repo): strengthen definition of done`.
