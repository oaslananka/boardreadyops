# Getting Started Tutorial

This tutorial walks through a minimal BoardReadyOps validation loop for a KiCad
project. It is intended for new users who want a working local and CI path before
customizing rules.

## Prerequisites

- Node.js version listed in `docs/support-matrix.md`.
- `corepack` enabled.
- Optional: KiCad CLI when running DRC/ERC or artifact generation.

## 1. Install the CLI

```bash
corepack enable
npm i -g boardreadyops
boardreadyops --help
```

For local repository development, use the pinned package manager instead:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

## 2. Create a configuration file

Create `boardreadyops.yml` in the KiCad project root:

```yaml
version: 1
mode: warn
fail-on: high
report:
  json: build/boardreadyops.findings.json
  markdown: build/boardreadyops.report.md
  sarif: build/boardreadyops.sarif.json
```

## 3. Run a local check

```bash
boardreadyops check .
```

Use `--format json` on commands that support machine-readable output when wiring
BoardReadyOps into agents or CI.

## 4. Generate release evidence

When KiCad CLI is available:

```bash
boardreadyops generate . --output build/boardreadyops-generate
boardreadyops release prepare . --output build/boardreadyops-release
boardreadyops release verify build/boardreadyops-release
```

## 5. Add the GitHub Action

Start with the pinned example in `README.md`, then require the status checks in
branch protection once the workflow is stable.

## 6. Next steps

- Read `docs/how-to/ci-quality-gates.md` for CI hardening.
- Read `docs/development/testing-policy.md` before contributing rule changes.
- Read `docs/security/release-integrity.md` before publishing release artifacts.
