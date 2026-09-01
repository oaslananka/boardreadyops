# Testing Policy

BoardReadyOps treats tests as release evidence. Changes should include the
narrowest meaningful test and pass the repository gate before merge.

## Test levels

| Level | Command | Purpose |
| --- | --- | --- |
| Unit | `corepack pnpm run test:unit` | Rule, parser, report, CLI helper, and script behavior. |
| Integration | `corepack pnpm run test:int` | CLI, KiCad, filesystem, fixture, and cross-surface behavior. |
| Action | `corepack pnpm run test:action` | GitHub Action edge behavior. |
| Property | `corepack pnpm run test:property` | Invariants and round trips. |
| Snapshot | `corepack pnpm run test:snapshot` | Stable output contracts. |
| Coverage | `corepack pnpm run coverage` | Coverage thresholds. |
| Mutation | `corepack pnpm run mutation` | Test strength for core/rule/parser paths. |
| Accessibility | `corepack pnpm run test:a11y` | HTML and docs accessibility coverage. |
| QA / E2E | `corepack pnpm run qa:audit` | Real-browser route audit: HTTP health, console/page errors, axe WCAG A/AA, DOM sanity, overflow, touch targets. See [QA agent guide](qa-agent.md). |

## Integration isolation

Integration test files run without file-level parallelism. PostgreSQL suites
share one ephemeral database and exercise a server-authoritative global claim
queue, so parallel files can claim or clean up another file's fixture data.
Keep `--no-file-parallelism` on `test:int` until every database-backed file has
an isolated database or schema. Tests within each file retain their normal
ordering and concurrency semantics.

## Required evidence in PRs

Every pull request should list command results in the PR body. Public contract
changes should include schema/snapshot updates and explain compatibility impact.

## Flaky tests

Do not mark flaky checks as required branch protection checks until the root cause
is fixed. Track flakes with an issue and include the failing command, logs, and
platform.

## Complete monorepo verification

Run `corepack pnpm run verify:all` after `corepack pnpm run toolchain:bootstrap` to validate the root package, the environment-independent integration suite, cloud workspaces, production web build, standalone runtime smoke, worker boundary, workflow security linting, and cloud coverage gates. The command records the integration result and prints a final summary that distinguishes tested surfaces from environment-dependent suites.

Cloud coverage is measured separately with `corepack pnpm run coverage:cloud`. The initial non-regression floors are encoded in `vitest.cloud.config.ts` for `apps/web`, `packages/cloud-core`, `packages/contracts`, and `packages/db`. CI uploads the LCOV and JUnit files under the distinct Codecov `cloud` flag; root coverage remains under `core`.

### PostgreSQL-backed integration prerequisites

Database-backed files under `tests/integration/*-postgres.test.ts` require:

1. PostgreSQL 16 or newer reachable from the test host.
2. A disposable database owned by the test user, with permission to create schemas, tables, functions, triggers, and extensions used by migrations.
3. `DATABASE_URL` set to that database, for example `postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_test`.
4. No production or shared database credentials. The suites apply migrations and delete test fixtures.

Run them serially with `BOARDREADYOPS_POSTGRES_TESTS=true DATABASE_URL=... corepack pnpm run test:int` or use the same variables with `corepack pnpm run verify:all`. Both local and CI execution require this explicit opt-in. The repository-local `boardreadyops_toolchain` URL is configuration-only and is rejected as a PostgreSQL test target. Without the opt-in, the final verification summary marks PostgreSQL integration as environment-dependent rather than claiming it was tested.

KiCad execution inside `verify:all` is opt-in with `BOARDREADYOPS_KICAD_TESTS=true` and an absolute `BOARDREADYOPS_KICAD_CLI` path. Without both values, the summary records the KiCad suite as skipped and environment-dependent.
