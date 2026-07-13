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
