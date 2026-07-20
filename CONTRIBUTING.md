# Contributing

BoardReadyOps is a local-first KiCad review tool. Contributions should keep the
CLI, GitHub Action, generated reports, schemas, and documentation predictable for
hardware teams that run the project in CI.

## Local Setup

Use a Node.js runtime listed in the [support matrix](docs/support-matrix.md) and
the pnpm version pinned by the `packageManager` field in `package.json`.

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

KiCad is optional for unit-only work and required for DRC/ERC integration
coverage. Install a supported KiCad line from the
[official KiCad downloads](https://www.kicad.org/download/) and confirm that
`kicad-cli` is available:

```bash
kicad-cli version
```

The repository supports KiCad 9.x and 10.x, with 10.x recommended for variant
and IPC API work. Use `docs/support-matrix.md` for the current tested versions.

## Development Loop

Run the narrowest useful command while editing, then run the required validation
chain before opening or updating a pull request.

```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test:unit
```

Install the repository's local security hooks before pushing changes:

```bash
python3 -m venv .venv-pre-commit
.venv-pre-commit/bin/python -m pip install pre-commit==4.6.0
.venv-pre-commit/bin/pre-commit install --hook-type pre-commit --hook-type pre-push
```

Semgrep, Snyk, and SonarQube for IDE Connected Mode setup is documented in
[docs/development/security-tooling.md](docs/development/security-tooling.md).

Generated Action and CLI bundles are committed. Source changes that affect the
CLI, Action, reports, generated docs, package metadata, or public schemas must
regenerate and verify the matching outputs:

```bash
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run docs
```

The canonical test taxonomy is in [docs/testing.md](docs/testing.md).

## Required PR Validation

Every code or documentation pull request must run this repository-level chain
from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run build
corepack pnpm run verify:dist
```

Run extra checks when the touched surface needs them:

| Change surface                             | Additional validation                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Rules, core pipeline, findings, reports    | `corepack pnpm run coverage`                                              |
| Mutation-sensitive core behavior           | `corepack pnpm run mutation` and `corepack pnpm run mutation:check`       |
| Docs navigation or generated docs          | `corepack pnpm run docs`                                                  |
| MkDocs or HTML report accessibility        | `corepack pnpm run test:a11y`                                             |
| Public docs, generated files, repo hygiene | `corepack pnpm run gc` and `corepack pnpm run knip`                       |
| Architecture imports or layer boundaries   | `corepack pnpm run verify:structure`                                      |
| Security policy, licenses, dependencies    | `corepack pnpm run security`                                              |
| GitHub workflows                           | `actionlint`, `yamllint`, and `zizmor` against the changed workflow files |

`task verify` remains the full local gate used by maintainers. It requires the
same package manager and may run more than the minimum PR chain.

## Test Categories

Use these focused commands before the full required chain:

| Category       | Command                           | Use for                                                                                                              |
| -------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Unit           | `corepack pnpm run test:unit`     | Deterministic module, rule, report, CLI helper, and script behavior.                                                 |
| Integration    | `corepack pnpm run test:int`      | CLI, fixture, filesystem, KiCad, multi-project, and cross-surface behavior.                                          |
| Property       | `corepack pnpm run test:property` | Invariants such as sorting, fingerprints, and parse/format round trips.                                              |
| Snapshot       | `corepack pnpm run test:snapshot` | Stable report contracts and expected formatted output.                                                               |
| Action         | `corepack pnpm run test:action`   | GitHub Action input parsing, outputs, artifact behavior, and edge integration.                                       |
| Coverage       | `corepack pnpm run coverage`      | Coverage thresholds configured in `vitest.config.ts`.                                                                |
| Mutation       | `corepack pnpm run mutation`      | Mutation score thresholds configured in `stryker.config.mjs` and checked by `scripts/check-mutation-thresholds.mjs`. |
| Performance    | `corepack pnpm run benchmark`     | Throughput changes in parsing, traversal, pipeline, and report formatting.                                           |
| Accessibility  | `corepack pnpm run test:a11y`     | MkDocs and HTML report accessibility coverage.                                                                       |
| Generated docs | `corepack pnpm run docs`          | Rule docs, compatibility docs, action docs, and MkDocs build.                                                        |

Fixture expectations live under `tests/fixtures/projects/**/expected-findings.json`.
When adding or changing a fixture, include the rule coverage reason, expected
findings, and any generated outputs needed by the rule under test.

## Adding A Rule

Follow the closest `AGENTS.md` file before editing rule code. Rule changes
normally touch:

- `src/rules/<domain>/...` for implementation.
- `src/rules/_index.ts` for registration.
- `src/core/findings.ts` only when the finding contract changes.
- `docs/rules/<rule-id>.md` and the domain overview under `docs/rules/`.
- Unit tests under `tests/unit/rules/` or focused integration fixtures under
  `tests/fixtures/projects/`.

Rules should emit normalized findings, use stable fingerprints, avoid direct
process exits, and keep KiCad parsing behind the existing `src/kicad/`,
`src/bom/`, and `src/pinmap/` helpers. Run `corepack pnpm run verify:structure`
after changes that touch layer imports.

## Adding A Report Emitter Or Field

Report modules consume run results and must not call rule implementations. A new
emitter or finding field normally requires:

- `src/report/**` implementation.
- `src/core/findings.ts` updates for shared finding/run result types.
- `schemas/findings.schema.json` updates when JSON output changes.
- Unit or snapshot tests for deterministic output.
- Docs under `docs/reports/`.

When reports change public contracts, run `corepack pnpm run test:snapshot`,
`corepack pnpm run coverage`, and `corepack pnpm run docs`.

## Adding A Vendor Profile

Vendor-specific behavior must be isolated from generic rules. When the vendor
profile module exists, keep the profile implementation under `src/vendors/` with
one directory per fab house, document the supported assumptions, and add tests
with representative fabrication-output fixtures.

Until that module lands, vendor-targeted contributions should stay in
configuration docs, fixtures, and generic manufacturing rules. Do not hard-code
one fab house's limits into shared rule helpers unless the issue explicitly
changes the generic rule contract.

## Adding A Locale

English is the source locale. Locale changes normally touch:

- `src/i18n/catalog.ts` for typed message identifiers.
- `src/i18n/en.ts` for source strings.
- `src/i18n/<locale>.ts` for translated strings.
- CLI, Action, or report tests that exercise user-facing output.

Run `corepack pnpm run i18n:check` or the full `corepack pnpm run lint` command
after locale changes.

## Action Inputs And Bundles

Action input changes require synchronized updates:

- `action.yml`
- `src/action/inputs.ts`
- Generated docs from `corepack pnpm run docs`
- Action tests under `tests/action/`
- Committed bundles from `corepack pnpm run build`
- `corepack pnpm run verify:dist`

Do not edit `dist/` by hand.

## Commits And Branches

Use Conventional Commits:

```text
type(scope): short imperative summary
```

Accepted scopes are enforced by `commitlint.config.cjs`. Common scopes include
`cli`, `action`, `mcp`, `rules`, `report`, `core`, `adapters`, `vendors`,
`docs`, `deps`, `release`, and `ci`; existing domain-specific scopes such as
`bom`, `pinmap`, `mfg`, and `kicad` remain valid for focused changes.

Agent branches use the Linear issue identifier:

```text
codex/BOARD-<id>-<short-slug>
```

Keep each pull request scoped to one Linear issue. Link the issue in the PR body
and record the commands that passed.

## Pull Requests

The pull request template lives at `.github/pull_request_template.md`. Fill in:

- Scope and user-visible impact.
- Related Linear issue.
- Validation commands and results.
- Checklist items that apply to docs, generated artifacts, Action bundles,
  schema changes, and branch protection documentation.

The repository-level governance and review model is documented in
[GOVERNANCE.md](GOVERNANCE.md) and [docs/governance.md](docs/governance.md).

## Security And Secrets

Never commit credentials, token-bearing environment files, cookies, private keys,
or generated secret stores. Use environment variable names in configuration and
repository or organization secrets in GitHub Actions.

Run `corepack pnpm run security` after dependency, license, workflow, or
supply-chain changes. Vulnerabilities should be reported through GitHub Security
Advisories as described in [SECURITY.md](SECURITY.md).
