# AGENTS.md

## What This Repository Is

BoardReadyOps is a local-first CLI and GitHub Action for KiCad hardware review. Its public surfaces are the `boardreadyops` binary, `action.yml`, generated report formats, schemas under `schemas/`, and documentation under `docs/`.

## Setup

- Enable the package manager shim when permitted: `corepack enable`
- Install dependencies: `corepack pnpm install --frozen-lockfile`
- Build committed bundles: `corepack pnpm run build`
- Verify committed bundles: `corepack pnpm run verify:dist`

## Build And Test

- Lint: `task lint`
- Typecheck: `task typecheck`
- Test with coverage: `task test`
- Integration tests: `task test:int`
- Action tests: `task test:action`
- Build: `task build`
- Docs: `task docs`
- Garbage collection checks: `task gc`
- Structure checks: `task verify:structure`
- Full local verify: `ALLOW_MAJOR_RELEASE=true task verify`

## Repository Layout

- `.github/` contains issue templates, rulesets, and hosted-runner workflows.
- `renovate.json` owns dependency version-update policy.
- `dist/` contains the two committed Node action and CLI bundles.
- `docs/` contains MkDocs pages, rule docs, reports docs, and ADRs.
- `schemas/` contains JSON schemas for config, findings, and pinmaps.
- `scripts/` contains build, docs, dist, structure, and drift verification scripts.
- `src/` contains the TypeScript implementation.
- `tests/` contains unit, integration, action tests, and KiCad fixtures.

## Conventions

- Style is enforced by Biome in `biome.json`; do not suppress rules globally.
- Types are strict through `tsconfig.json`; avoid `any` unless an upstream type boundary requires a one-line justification.
- Commits use Conventional Commits with scopes from `commitlint.config.cjs`.
- Tests exercise behavior, not only execution. Use fixtures when a rule depends on KiCad-like files.
- Errors are normalized at the CLI and Action edges. Internal helpers return typed values where practical.
- Generated docs and bundles must be idempotent.

## Architectural Rules

- CLI and Action code sit at the runtime edge and may call core, report, and util modules. CLI diagnostics may also call KiCad helpers.
- Core owns config, discovery, findings, registry, concurrency, and pipeline orchestration.
- Rule modules may call core types, KiCad parsers, BOM loaders, pinmap loaders, and util helpers.
- Report modules consume run results and must not call rule implementations.
- KiCad parsing may reuse canonical BOM row types, and pinmap CSV loading may reuse the shared delimited parser from the BOM loader.
- Utility modules do not import higher layers.
- Enforcement: `task verify:structure`.

## Where Decisions Live

- Architecture decisions: `docs/architecture/adr/`
- Security policy: `SECURITY.md`
- Contribution rules: `CONTRIBUTING.md`
- Dependency automation policy: `docs/dependency-automation.md`
- Rule behavior: `docs/rules/` and `src/rules/`
- Report contracts: `docs/reports/` and `schemas/findings.schema.json`

## Common Tasks

- Add a new rule: follow `src/rules/AGENTS.md`.
- Add a report field: update `src/core/findings.ts`, `schemas/findings.schema.json`, report emitters, and tests.
- Update Action inputs: edit `action.yml`, run `corepack pnpm run docs`, and update action tests.
- Regenerate bundles: `corepack pnpm run build && corepack pnpm run verify:dist`.
