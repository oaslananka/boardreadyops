# Codecov Observability Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codecov Test Analytics, production client-bundle analysis, component reporting, and repository YAML validation without duplicating tests or replacing local quality gates.

**Architecture:** `ci / coverage-gate` remains the single LCOV source and gains JUnit output plus a second Codecov upload. A framework-independent Codecov analyzer scans `apps/web/.next/static` after the production build because the current Next.js-specific plugin does not support Next.js 16. `codecov.yml` supplies advisory coverage, bundle, and component views while local thresholds remain blocking.

**Tech Stack:** GitHub Actions, Codecov Action v7 pinned at `fb8b3582c8e4def4969c97caa2f19720cb33a72f`, Vitest 4 JUnit reporter, Next.js 16, `@codecov/bundle-analyzer@2.0.1`, `js-yaml`.

## Global Constraints

- Do not add another test execution solely for Codecov.
- Keep Codecov upload failures and statuses non-blocking.
- Do not require a new secret for public or fork pull requests.
- Keep all GitHub Actions pinned to immutable commit SHAs.
- Use bundle name `boardreadyops-web` and a 5% informational warning threshold.
- Use project and patch targets `auto` with a 1% informational threshold.
- Remove the unused `integration` coverage flag.
- Do not add component-level required statuses.
- Do not install a package with an unmet Next.js or Webpack peer dependency.

---

### Task 1: Define the Codecov contract with failing tests

**Files:**
- Create: `tests/unit/scripts/codecov-integration.test.ts`
- Read: `.github/workflows/ci.yml`
- Read: `codecov.yml`
- Read: `package.json`
- Read: `apps/web/package.json`

**Interfaces:**
- Consumes repository files as UTF-8 text and parses YAML with `js-yaml`.
- Produces regression assertions for coverage, Test Analytics, bundle analysis, and YAML policy.

- [ ] Write tests for conditional GitHub reporter selection, optional bundle tokens, pinned upload actions, component policy, and framework-independent bundle analysis.
- [ ] Run `pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts`.
- [ ] Confirm failures are caused by missing Codecov behavior.
- [ ] Commit with `test(ci): define Codecov observability contract`.

### Task 2: Produce JUnit and upload Test Analytics

**Files:**
- Create: `scripts/run-codecov-coverage.mjs`
- Create: `scripts/run-codecov-coverage.d.mts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces `buildCodecovCoverageArguments({ githubActions?: boolean }): string[]`.
- Produces `coverage/lcov.info` and `coverage/test-results.junit.xml` from one Vitest execution.

- [ ] Implement reporter selection: default and JUnit everywhere, GitHub Actions reporter only when `GITHUB_ACTIONS=true`.
- [ ] Add `coverage:ci` delegating to the runner.
- [ ] Add Codecov YAML validation using `https://codecov.io/validate`.
- [ ] Upload LCOV and JUnit through the existing pinned Codecov Action.
- [ ] Set `report_type: test_results`, `disable_search: true`, `fail_ci_if_error: false`, and `if: ${{ !cancelled() }}`.
- [ ] Run the focused contract test.
- [ ] Run `pnpm run coverage:ci` in a normal-permission clone and verify both files exist.
- [ ] Commit with `feat(ci): upload Codecov test analytics`.

### Task 3: Analyze the production client bundle

**Files:**
- Create: `scripts/run-codecov-bundle-analysis.mjs`
- Create: `scripts/run-codecov-bundle-analysis.d.mts`
- Create: `codecov-bundle.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces `buildCodecovBundleArguments({ uploadToken?: string }): string[]`.
- Consumes `apps/web/.next/static` and optional `CODECOV_TOKEN`.

- [ ] Add pinned root dev dependency `@codecov/bundle-analyzer@2.0.1`.
- [ ] Configure `gitService: "github"`, `telemetry: false`, retry count 3, and source-map exclusion.
- [ ] Implement the runner so `--upload-token` is omitted when no token is available.
- [ ] Add `codecov:bundle` and invoke it after `cloud:build` in the build job.
- [ ] Run `pnpm peers check` and require zero peer dependency issues.
- [ ] Run `pnpm run cloud:typecheck` and `pnpm run cloud:build`.
- [ ] Run analyzer dry-run against `apps/web/.next/static` and confirm a valid `boardreadyops-web` report.
- [ ] Commit with `feat(ci): add Codecov bundle analysis`.

### Task 4: Configure advisory coverage and components

**Files:**
- Modify: `codecov.yml`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces advisory project, patch, bundle, and component views from the existing uploads.

- [ ] Set project and patch targets to `auto`, threshold to `1%`, and `informational: true`.
- [ ] Keep only the `unit` flag.
- [ ] Add core, rules, BOM, pinmap, KiCad, reporting, notifications, and Action-input components.
- [ ] Add informational bundle status with a 5% warning threshold.
- [ ] Validate with `curl --fail-with-body --data-binary @codecov.yml https://codecov.io/validate`.
- [ ] Run the focused contract test.
- [ ] Commit with `feat(ci): configure Codecov components`.

### Task 5: Document and verify

**Files:**
- Create: `docs/integrations/codecov.md`
- Modify: `mkdocs.yml`

**Interfaces:**
- Produces operator documentation for local gates, uploads, bundle analysis, authentication, components, validation, and troubleshooting.

- [ ] Document that Codecov is advisory and local thresholds remain authoritative.
- [ ] Document JUnit failed-test behavior and tokenless fork handling.
- [ ] Document why the generic analyzer is used for Next.js 16.
- [ ] Add the page to MkDocs navigation.
- [ ] Run focused tests, lint, typecheck, Knip, docs, security, distribution verification, production build, and coverage.
- [ ] Push the branch and open `feat(ci): expand Codecov observability`.
- [ ] Inspect every bot/agent review, PR comment, check annotation, and suggested change.
- [ ] Resolve actionable findings and merge only after required checks are green.
