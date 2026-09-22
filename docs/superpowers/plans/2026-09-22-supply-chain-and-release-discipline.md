# Supply Chain and Release Discipline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove mutable bootstrap/execution references, centralize release identity, make verification tiers unambiguous, and introduce a stable release train appropriate for an assurance product.

**Architecture:** Release automation becomes the source of immutable consumer references. Generated workflows, README/action docs, installers, agent dependencies, runtime metadata, and release channels consume generated release identity. CI is consolidated into explicit verification tiers without dropping security scanners.

**Tech Stack:** GitHub Actions, TypeScript/Node scripts, pnpm, Renovate, existing release/signing/SBOM workflows.

**Spec:** `docs/superpowers/specs/2026-09-22-assurance-hardening-program-design.md`

## Global Constraints

- Consumer examples prefer immutable commit/digest identity.
- Bootstrap code is not executed from mutable `main`.
- Executable agent tooling is pinned.
- Release identity is generated once and reused.
- CI consolidation cannot reduce current scanner or required-check coverage.
- Stable releases require an RC/stabilization gate distinct from continuous main.

## Review Focus

- `boardreadyops init --workflow github` must not emit `oaslananka/boardreadyops@v1`.
- README/action docs must not label an old immutable SHA as current.
- Installer instructions must remain safe if `main` moves.
- `.mcp.json` must not execute `@latest`.
- A release candidate with a failed deep gate must not promote to stable.

---

### Task C1: Generate immutable Action references everywhere

**Files:**
- Modify: `src/cli/commands/init.ts`
- Create/extend: release metadata generator under `scripts/`
- Generate: a release identity module/file consumed by docs/init
- Modify: `README.md`
- Modify: `docs/action.md`
- Test: init command snapshots/unit tests
- Test: docs/release drift tests

**Interfaces:**
- Release metadata exposes current version and immutable Action commit SHA.
- Workflow generator renders `uses: oaslananka/boardreadyops@<sha>` with a version comment.

- [ ] **Step 1: Write RED init test** rejecting `@v1` and requiring a 40-hex immutable SHA.
- [ ] **Step 2: Write RED docs drift test** requiring README/action current version and immutable SHA to come from the same release metadata.
- [ ] **Step 3: Add generated release identity** updated by release automation; do not hand-copy SHAs across files.
- [ ] **Step 4: Update init workflow renderer and public examples.**
- [ ] **Step 5: Generate twice and require clean-tree idempotency.**
- [ ] **Step 6: Commit `fix(release): pin generated Action workflows`.

### Task C2: Make installer bootstrap immutable and verifiable

**Files:**
- Modify: `README.md`
- Modify: installation docs
- Modify: `install.sh`
- Modify: `install.ps1`
- Modify: release workflow/scripts that publish installer assets
- Test: installer smoke/integrity tests

**Interfaces:**
- Documented bootstrap URL points to a release tag or immutable commit, not `main`.
- Release publishes installer checksum/signature or attestation alongside binary checksums.

- [ ] **Step 1: Write a content-policy RED test** rejecting raw GitHub `/main/install.sh` and `/main/install.ps1` execution examples.
- [ ] **Step 2: Publish installer scripts as versioned release assets** or pin raw URLs to the exact release tag/commit.
- [ ] **Step 3: Verify bootstrap script identity** before it downloads binaries where practical; retain existing binary checksum verification.
- [ ] **Step 4: Add Linux and PowerShell smoke tests** in clean temporary directories.
- [ ] **Step 5: Commit `fix(release): make installer bootstrap immutable`.

### Task C3: Pin executable development-agent dependencies

**Files:**
- Modify: `.mcp.json`
- Modify: `docs/development/qa-agent.md`
- Modify: `renovate.json` custom manager if needed
- Test: repository security/config policy tests

**Interfaces:**
- `@playwright/mcp` uses an exact reviewed version.
- Renovate can discover/update that exact version through the normal review path.

- [ ] **Step 1: Add RED config test** that rejects `@latest` in executable MCP/server commands.
- [ ] **Step 2: Pin `@playwright/mcp` to the reviewed current version** and update QA docs.
- [ ] **Step 3: Add a Renovate regex/custom manager** only if the existing manager cannot update `.mcp.json`.
- [ ] **Step 4: Run security automation tests and commit `chore(deps): pin Playwright MCP`.

### Task C4: Centralize runtime/release identity and distribution policy

**Files:**
- Modify: generated version/build metadata
- Modify: runner/control-plane setup code containing duplicated engine versions
- Modify: binary release scripts
- Test: version drift tests
- Docs: distribution/install matrix

**Interfaces:**
- One generated object provides `version`, `sourceCommit`, Action SHA/container digest where applicable.
- Runner/client compatibility uses that source rather than duplicated literals.

- [ ] **Step 1: Search production source for hard-coded product versions** and encode allowed exceptions in a test fixture.
- [ ] **Step 2: Replace runtime literals** with generated release/build identity.
- [ ] **Step 3: Add a drift test** that fails when public package/action/runner identities disagree.
- [ ] **Step 4: Document binary size/distribution strategy**; prefer compressed release assets/package-manager caching before executable compression that would complicate signatures.
- [ ] **Step 5: Commit `refactor(release): centralize runtime identity`.

### Task C5: Define verification tiers and consolidate workflow duplication

**Files:**
- Modify: `package.json` scripts
- Modify: `Taskfile.yml`
- Modify: selected `.github/workflows/*.yml`
- Create reusable workflows if duplication is material
- Modify: `CONTRIBUTING.md`
- Test: workflow/config tests, actionlint/yamllint/zizmor

**Interfaces:**
- Canonical tiers:
```text
verify:fast
verify:prepush
verify:integration
verify:release
```
- `verify:release` includes real DB/KiCad/package/binary/provenance/signing/SBOM checks required for a release.

- [ ] **Step 1: Inventory existing scripts/workflows** and map every current required check/scanner to one tier; no scanner may disappear during consolidation.
- [ ] **Step 2: Rename misleading `security` scripts** if they only perform license/NOTICE/REUSE compliance; keep a clearly named vulnerability/static security aggregate.
- [ ] **Step 3: Add canonical tier scripts** as composition over existing commands first.
- [ ] **Step 4: Consolidate duplicated workflow setup into reusable workflows** only after status-check names required by rulesets are preserved or migrated deliberately.
- [ ] **Step 5: Run actionlint, yamllint, zizmor, workflow unit/config tests, and all tier entry points.**
- [ ] **Step 6: Commit `chore(ci): define canonical verification tiers`.

### Task C6: Make generated compliance output reproducible and automation health visible

**Files:**
- Modify: NOTICE/license generation scripts
- Modify: relevant tests/workflows
- Modify: Renovate health/dashboard policy docs/tests
- Modify: dependency automation docs

**Interfaces:**
- NOTICE generation produces identical bytes on supported Linux/Windows environments.
- Dependency automation surfaces auth/config/abandoned-package failures as actionable failures.

- [ ] **Step 1: Add deterministic NOTICE fixture/hash test** with normalized ordering/newlines and lockfile-derived dependency set.
- [ ] **Step 2: Reproduce Windows/Linux mismatch** in CI matrix and fix platform-dependent enumeration.
- [ ] **Step 3: Add Renovate health assertions** for registry/container auth and abandoned/deprecated dependency signals where machine-readable data is available.
- [ ] **Step 4: Document remediation path** for bot health rather than accepting a permanently noisy dashboard.
- [ ] **Step 5: Commit `fix(repo): make compliance automation reproducible`.

### Task C7: Introduce a stable release train

**Files:**
- Modify: release workflow/configuration
- Modify: release docs
- Modify: current-state/release policy docs
- Test: release workflow policy tests

**Interfaces:**
- Channels: `main/continuous → canary or rc → stable`.
- Stable promotion requires the release verification tier and explicit stabilization criteria.

- [ ] **Step 1: Write a release-policy RED test** proving stable publication cannot occur directly from an unqualified main build if RC gating is enabled.
- [ ] **Step 2: Add RC tag/channel mechanics** compatible with existing release automation.
- [ ] **Step 3: Require `verify:release` plus nightly/deep gates** for stable promotion.
- [ ] **Step 4: Define stabilization window by criteria**, not an invented fixed duration: no unresolved release-blocking defects, required soak/drill checks green, provenance/signing verified.
- [ ] **Step 5: Update public docs** so continuous internal deploy cadence is not confused with stable CLI/Action compatibility guarantees.
- [ ] **Step 6: Commit `feat(release): add stabilization release channel`.
