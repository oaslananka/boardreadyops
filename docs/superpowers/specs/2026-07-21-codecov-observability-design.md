# Codecov Observability Integration Design

Date: 2026-07-21
Status: approved and implementation-validated

## Context

BoardReadyOps already uploads one Vitest LCOV report from `ci / coverage-gate` and enforces strict local coverage thresholds. The repository did not upload test-result telemetry, validate `codecov.yml`, expose useful coverage components, or analyze the production web bundle.

The repository is public, uses a full-SHA-pinned Codecov Action v7 commit, runs Vitest 4, and builds the web control plane with Next.js 16 in Webpack mode.

## Considered approaches

### YAML-only hardening

Only update status thresholds, comments, and components.

Trade-off: minimal dependency and CI impact, but failed-test reporting and production bundle regressions remain invisible.

### Focused Codecov observability integration — selected

Keep one coverage run, add JUnit output to that run, upload coverage and test results separately through the existing pinned Codecov Action, analyze the built browser assets after the production Next.js build, and improve repository YAML with components and validation.

Trade-off: one framework-independent development dependency and additional advisory uploads without duplicating test execution.

### Full matrix and per-package uploads

Upload coverage and test results from every operating-system and Node.js matrix entry with separate flags.

Trade-off: maximal analytics, but substantially more CI time, duplicate reports, noisy statuses, and unnecessary Codecov usage for the current project scale.

## Selected design

### Coverage and Test Analytics

- Keep `coverage/lcov.info` as the authoritative Codecov coverage report.
- Add a CI-only runner that executes the existing coverage selection once.
- Use Vitest's default and JUnit reporters everywhere.
- Add Vitest's GitHub Actions reporter only when `GITHUB_ACTIONS=true` so local runs remain readable.
- Write JUnit output to `coverage/test-results.junit.xml`.
- Upload coverage and test results with separate invocations of the pinned `codecov/codecov-action` commit.
- Use `report_type: test_results` for the JUnit upload.
- Run both upload steps under `if: ${{ !cancelled() }}` so failed-test telemetry can still be sent.
- Keep upload failures non-blocking because repository-local thresholds remain authoritative.

### JavaScript Bundle Analysis

The initial Next.js-specific plugin was rejected during implementation because `@codecov/nextjs-webpack-plugin@2.0.1` declares peer support only for Next.js 14 and 15, while BoardReadyOps uses Next.js 16.2.10.

- Use the official `@codecov/bundle-analyzer@2.0.1` package instead.
- Run it after a successful production build against `apps/web/.next/static`.
- Use bundle name `boardreadyops-web`.
- Pass `CODECOV_TOKEN` only when available.
- Configure `gitService: "github"` so public and fork builds can use tokenless upload behavior.
- Disable analyzer telemetry and ignore source maps.
- Keep bundle status informational with a 5% warning threshold.
- Preserve the repository's existing local bundle-size budget as the blocking control.

### Repository YAML

- Set project and patch targets to `auto` with a 1% threshold.
- Keep both statuses informational to avoid duplicating the local coverage gate and SonarQube Cloud reporting.
- Keep only the `unit` flag because it is the only flag uploaded.
- Add components for:
  - core engine
  - rules
  - BOM and supply-chain logic
  - pinmap contracts
  - KiCad integration
  - reporting and notifications
  - GitHub Action inputs
- Do not create component-level required status checks.
- Preserve ignored generated bundles under `dist/**`.

### Validation and regression tests

- Validate `codecov.yml` against `https://codecov.io/validate` before uploads.
- Add repository tests that assert:
  - reporter selection changes only inside GitHub Actions;
  - LCOV and JUnit uploads use the pinned Codecov Action;
  - JUnit uploads use `report_type: test_results` and non-cancelled execution;
  - optional bundle authentication omits the token argument when unavailable;
  - the framework-independent analyzer scans the production client assets;
  - the incompatible Next.js-specific plugin is absent;
  - the unused integration flag is removed;
  - component and informational policies remain present.
- Verify the production build and analyzer with a dry run before merge.

## Security and reliability

- No new long-lived secret is required; the existing `CODECOV_TOKEN` is reused for internal builds.
- Fork pull requests remain compatible through tokenless upload behavior.
- The Codecov Action remains pinned to an immutable commit.
- The analyzer runs only as an explicit post-build CI step, not during local or deployment builds.
- Codecov remains advisory; local Vitest thresholds and bundle-size budgets remain the merge gates.

## Acceptance criteria

1. One test execution can produce both LCOV and JUnit reports.
2. Failed tests are represented in the JUnit file and can be uploaded after a non-cancelled failure.
3. The production Next.js client assets produce a valid Codecov bundle report without a Next.js peer dependency conflict.
4. Codecov PR comments expose meaningful components without creating a status matrix.
5. `codecov.yml` validates through Codecov's official endpoint.
6. Existing build, type, test, security, and distribution controls remain green.
