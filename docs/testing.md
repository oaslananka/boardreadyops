# Testing

This is the contributor entry point for BoardReadyOps test coverage. Run the narrowest useful check while developing, then run the required validation chain before opening or updating a pull request.

## Required PR Validation

Run these commands from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run build
corepack pnpm run verify:dist
```

Changes that affect generated docs, reports, rules, Action inputs, release metadata, or committed bundles also need the matching script from the sections below.

## Unit Tests

Unit tests live under `tests/unit/` and cover deterministic module behavior, rule outcomes, report emitters, CLI helpers, and scripts without requiring KiCad to be installed.

```bash
corepack pnpm run test:unit
```

Use unit tests for new helpers, rule branches, report formatting, config validation, script behavior, and bug fixes that can be expressed with local fixtures.

## Integration Tests

Integration tests live under `tests/integration/` and exercise CLI behavior, multi-project discovery, cross-platform path handling, fabrication diffs, the fixture corpus, and PostgreSQL-backed cloud persistence.

```bash
corepack pnpm run test:int
corepack pnpm run test:int:monorepo
```

`test:int:monorepo` always runs the environment-independent integration files and records their status for the `verify:all` summary. PostgreSQL files require both `BOARDREADYOPS_POSTGRES_TESTS=true` and a disposable `DATABASE_URL`; the repository-local toolchain placeholder is never accepted as a test database. CI uses the same opt-in contract.

Use integration tests when behavior crosses the CLI, project discovery, fixture layout, filesystem, cloud persistence, or runtime boundaries.

## Property Tests

Property tests live under `tests/property/` and use `fast-check` for invariants over many generated inputs.

```bash
corepack pnpm run test:property
```

Use property tests for stable invariants such as fingerprint determinism, sorting idempotency, summary counts, config/report parseability, and format round trips.

## Snapshot Tests

Snapshot tests live under `tests/snapshot/` and protect stable report contracts.

```bash
corepack pnpm run test:snapshot
```

Update snapshots only when the formatted contract intentionally changes:

```bash
corepack pnpm run test:snapshot -- -u
```

## Action Tests

Action tests live under `tests/action/` and validate GitHub Action input parsing, outputs, report artifact behavior, and CLI edge integration through the committed Action surface.

```bash
corepack pnpm run test:action
```

Because the Action uses committed bundles, run the build and dist verification commands after Action-surface changes:

```bash
corepack pnpm run build
corepack pnpm run verify:dist
```

## Mutation Tests

Mutation tests use Stryker with the Vitest runner. Stryker writes JSON and HTML reports under `reports/mutation/`, enforces an overall mutation score floor of 60%, and the repository check enforces at least 75% for `src/core/**`.

```bash
corepack pnpm run mutation
corepack pnpm run mutation:check
```

CI publishes the mutation report artifact and writes the overall/core mutation score table to the job summary. Add or strengthen tests when survived or no-coverage mutants expose behavior that is expected to be observable.

## Coverage

Coverage uses Vitest with the V8 provider and writes reports under `coverage/`.

```bash
corepack pnpm run coverage
```

Current coverage thresholds are configured in `vitest.config.ts` and are stricter than the public floor: 95% overall line coverage, 97% line coverage for `src/core/**`, 95% line coverage for report emitters, and 90% overall branch coverage. CI uploads coverage to Codecov and archives the `coverage/` directory as a workflow artifact.

## Performance Tests

Performance checks live under `tests/benchmark/` and track pipeline and formatter throughput for common fixtures.

```bash
corepack pnpm run benchmark
```

Use benchmarks for changes that affect traversal, parsing, report generation, concurrency, or fixture-scale execution. Keep benchmark expectations descriptive; blocking performance budgets belong in dedicated follow-up issues unless the issue explicitly asks for them.

## Fixture Tests

Project fixtures live under `tests/fixtures/projects/`. Each fixture keeps expected findings in `expected-findings.json`, including the rules it exists to exercise and a performance baseline used by fixture regression tests.

```bash
corepack pnpm run test:int -- tests/integration/fixtures.test.ts
```

When adding a fixture, include the KiCad files, any fixture config, generated outputs needed by the rule, and `expected-findings.json`.

## Accessibility Tests

Accessibility checks cover docs and HTML report output. They combine focused Vitest checks with a MkDocs build and pa11y scan.

```bash
corepack pnpm run test:a11y
```

Run accessibility tests when editing HTML templates, docs navigation, docs JavaScript/CSS, report layout, headings, landmarks, colors, or interactive report controls.

## Documentation And Generated Checks

Documentation and generated artifact drift are checked separately from the default unit test run:

```bash
corepack pnpm run docs
corepack pnpm run gc
corepack pnpm run verify:structure
corepack pnpm run knip
corepack pnpm run security
```

Run `docs` after changing docs navigation, generated rule docs, compatibility docs, or Action input docs. Run `gc` before PRs that touch generated docs, public docs, structure scripts, or repository hygiene.
