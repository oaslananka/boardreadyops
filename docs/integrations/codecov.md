# Codecov

BoardReadyOps uses Codecov as an advisory view over repository-owned quality gates. Codecov adds pull-request coverage context, failed-test reporting, component views, and production JavaScript bundle analysis without replacing local enforcement.

## Authoritative local gates

The blocking controls remain inside the repository:

- Vitest coverage thresholds in `vitest.config.ts`
- bundle budgets from `pnpm run check:size`
- native lint, type-check, test, build, security, and distribution checks

Codecov project, patch, and bundle statuses are informational. Upload failures do not override the local gates.

## Coverage policy

The repository uploads `coverage/lcov.info` with the `unit` flag. Codecov compares project and patch coverage with the default branch using:

- target: `auto`
- threshold: `1%`
- informational status

This policy reports regressions without creating a second required coverage gate alongside the stricter local Vitest thresholds.

## Test Analytics

`pnpm run coverage:ci` executes the existing coverage suite once and emits:

- `coverage/lcov.info`
- `coverage/test-results.junit.xml`

The CI runner enables Vitest's GitHub Actions reporter only inside GitHub Actions. Local runs use the normal console and JUnit reporters without annotation output.

The `ci / coverage-gate` job uploads both reports through the SHA-pinned Codecov Action. Upload steps use `if: ${{ !cancelled() }}` so a JUnit report containing failed tests can still reach Codecov after the test command exits non-zero.

## Bundle analysis

After the production Next.js build, the official `@codecov/bundle-analyzer` CLI scans `apps/web/.next/static`. The bundle is named `boardreadyops-web`; source maps are excluded from the report.

The generic analyzer is used because the current Next.js-specific Codecov plugin declares peer support only for Next.js 14 and 15, while BoardReadyOps uses Next.js 16. Internal builds use the `CODECOV_TOKEN` repository secret. Public fork pull requests omit the token argument and use Codecov's GitHub tokenless behavior. Analyzer telemetry is disabled.

Bundle status is informational with a `5%` warning threshold. The upload step is allowed to fail without failing `ci / build`; the local bundle-size budget remains blocking.

## Components

`codecov.yml` exposes virtual components over the single coverage report:

- core engine
- rules
- BOM and supply-chain logic
- pinmap contracts
- KiCad integration
- reporting and notifications
- GitHub Action inputs

Components appear in Codecov's pull-request comment and UI without creating a required status for every source area.

## Configuration validation

Validate repository YAML before merging a change:

```bash
curl --fail-with-body --silent --show-error \
  --retry 3 --retry-all-errors \
  --data-binary @codecov.yml \
  https://codecov.io/validate
```

The coverage job performs the same validation before report upload.

## Troubleshooting

When an upload is missing:

1. Confirm `coverage/lcov.info` or `coverage/test-results.junit.xml` exists in the uploaded `coverage-report` artifact.
2. Confirm `CODECOV_TOKEN` is available for an internal branch build.
3. Check the Codecov Action log for authentication, report parsing, or expired-report errors.
4. Validate `codecov.yml` with the command above.
5. For bundle reports, confirm `apps/web/.next/static` exists and `pnpm run codecov:bundle` ran after the production build.
