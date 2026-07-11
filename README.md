<div align="center">

# BoardReadyOps

**End-to-end hardware release pipeline for KiCad projects.**

Verified, signed, manufacturer-ready release packages for KiCad projects.
Generate artifacts, validate release readiness, package evidence, and produce a clear release decision.

[![CI](https://github.com/oaslananka/boardreadyops/actions/workflows/ci.yml/badge.svg)](https://github.com/oaslananka/boardreadyops/actions/workflows/ci.yml)
[![Security](https://github.com/oaslananka/boardreadyops/actions/workflows/security.yml/badge.svg)](https://github.com/oaslananka/boardreadyops/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/oaslananka/boardreadyops/badge)](https://scorecard.dev/viewer/?uri=github.com/oaslananka/boardreadyops)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13378/badge)](https://www.bestpractices.dev/projects/13378)

[![npm](https://img.shields.io/npm/v/boardreadyops)](https://www.npmjs.com/package/boardreadyops)
[![npm downloads](https://img.shields.io/npm/dt/boardreadyops)](https://www.npmjs.com/package/boardreadyops)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-BoardReadyOps-blue?logo=github)](https://github.com/marketplace/actions/boardreadyops)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Repository Maturity](docs/repo-maturity-report.md) ·
[OpenSSF Evidence](docs/openssf-evidence.md) ·
[Governance](GOVERNANCE.md) ·
[Roadmap](docs/ROADMAP.md) ·
[Support](SUPPORT.md)

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-ffdd00?logo=buymeacoffee&logoColor=black&labelColor=ffdd00&color=111111)](https://www.buymeacoffee.com/oaslananka)

</div>

BoardReadyOps turns a KiCad project into a verified, signed, manufacturer-ready release package. It generates manufacturing artifacts, validates release readiness, packages evidence, and produces a clear release decision — running locally as a CLI and in CI as a GitHub Action, with JSON, SARIF, Markdown, HTML, JUnit, and workflow annotation output.

```
Generate → Validate → Decide → Package → Attest → Review → Handoff
```

## Installation

```bash
npm i -g boardreadyops
```

The current public npm package is `boardreadyops@1.8.3`. It is verified on
Node.js 22.14+ and 24, includes the current CLI bundle, schemas, docs, Action
metadata, and matches the public `v1.8.3` tag archive.
Binary release assets should be verified against `v1.8.3`, which publishes the
current Linux, macOS, and Windows binary matrix, `SHA256SUMS`, and SBOM release
assets. See [release channel verification](docs/release/channel-verification.md)
for the tested artifact list and remaining channel follow-ups.

## Runtime Support

BoardReadyOps supports Node.js 22.14+ and 24. Node.js 24 is the recommended Active
LTS runtime; Node.js 22.14+ remains supported for Maintenance LTS users. Node.js 26
Current is tracked but not supported in `engines.node` or CI until it reaches
LTS and dependency validation is added.

KiCad CLI compatibility is CI-tested on KiCad 10.0, with 10.0.4 as the latest
verified patch. KiCad 9.0 remains the minimum supported line but is upstream EOL
and no longer CI-tested. The machine-readable policy and generated support table
live in [docs/support-matrix.md](docs/support-matrix.md).

### Install Via Script

Linux and macOS release binaries are installed with the checksum-verifying shell
installer when the selected GitHub Release includes the matching binary asset
and `SHA256SUMS`:

```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.sh | sh
```

Windows x64 release binaries use the same release asset and checksum flow:

```powershell
irm https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.ps1 | iex
```

The installers download the release asset plus `SHA256SUMS` before placing
`boardreadyops` on the local command path. Binary asset availability depends on
the release; check the [latest release](https://github.com/oaslananka/boardreadyops/releases/latest)
for the current asset matrix. A Homebrew
formula template for the same binary assets lives at `Formula/boardreadyops.rb`;
it is populated with published macOS and Linux checksums from `SHA256SUMS`.
The installers have been verified against the latest release which includes
the full binary matrix, `SHA256SUMS`, and SBOM. Tap publication remains a
maintainer follow-up.

## Positioning

BoardReadyOps provides two usage modes:

**End-to-end pipeline** — use `boardreadyops generate` to produce Gerbers, drill files, BOMs, CPL/position files, and PDFs via `kicad-cli`, then `boardreadyops release prepare` to validate, package evidence, and emit a signed release decision.

**Validation-only gate** — use KiBot or another generator to produce fabrication outputs, then use BoardReadyOps to validate those outputs exist, match the KiCad project, satisfy vendor/profile expectations, and can support a repeatable release decision.

See [Release readiness and KiBot integration](docs/integrations/kibot.md) for the pipeline split approach, and [the roadmap](docs/ROADMAP.md) for v2 features.

## Quick Start

```bash
# Validate existing manufacturing outputs
boardreadyops check .
boardreadyops plan . --format json > build/agent-plan.json

# Generate artifacts and prepare a full release
boardreadyops generate . --profile jlcpcb
boardreadyops release prepare . --profile jlcpcb --output build/release

# Verify a release bundle and create a vendor handoff package
boardreadyops release verify build/release
boardreadyops handoff create build/release --profile jlcpcb
```

`npx boardreadyops --help` also works when npm can resolve the package.

## GitHub Action

```yaml
name: BoardReadyOps

on:
  pull_request:
  push:
    branches: [main]

jobs:
  boardreadyops:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops@005afb83bd04f50a8da33bbffc441818910951f6 # v1.7.2
        with:
          config: boardreadyops.yml
          mode: enforce
          fail-on: high
```

SARIF upload requires `security-events: write`. Pull request comments require `pull-requests: write`.

Use the full container action when a workflow should carry KiCad CLI inside the
BoardReadyOps runtime instead of installing KiCad separately:

```yaml
      - uses: oaslananka/boardreadyops/apps/container@005afb83bd04f50a8da33bbffc441818910951f6 # v1.7.2
        with:
          config: boardreadyops.yml
          require-kicad: "true"
          mode: enforce
```

The same image can run as a CLI:

```bash
docker run --rm ghcr.io/oaslananka/boardreadyops-full:v1 --help
```

The `v1` and `latest` container tags resolve to the most recent release
image. Check the [release channel verification](docs/release/channel-verification.md)
for the current digest and manifest list.

## CLI

```bash
boardreadyops run --json build/findings.json --sarif build/findings.sarif.json .
boardreadyops check .
boardreadyops check manufacturing.jobset-outputs .
boardreadyops plan . --format json
boardreadyops doctor
boardreadyops schema config
```


`boardreadyops plan` is the machine-readable workflow for coding and hardware agents. It emits JSON actions with finding evidence, fix steps, safe-auto-fix flags, and verification commands so agents can repair KiCad, BOM, pinmap, manufacturing-output, or release metadata issues without scraping human reports. See [Agent Planning Output](docs/agent-planning.md).

The npm package exposes the `boardreadyops` binary from the committed CLI bundle in `dist/cli/index.cjs`.

## Configuration

Create `boardreadyops.yml`:

```yaml
version: 1
mode: warn
projects:
  - path: .
    pinmap: firmware/pins.yml
    bom: bom/board.csv
    variants:
      - name: production
        bom: bom/prod.csv
rules:
  bom.missing-mpn:
    enabled: true
    severity: high
    ignore-refs: ["TP*", "FID*"]
  bom.variant-consistency:
    enabled: true
  manufacturing.jobset-outputs:
    enabled: true
  manufacturing.outputs-present:
    enabled: true
    required: [gerber, drill, position, pdf]
fail-on: high
report:
  sarif: build/boardreadyops.sarif.json
  json: build/boardreadyops.findings.json
  markdown: build/boardreadyops.report.md
  html: build/boardreadyops.report.html
```

The config schema is committed at `schemas/config.schema.json`.

## Supported Checks

- KiCad DRC and ERC report normalization.
- BOM completeness, lifecycle, DNP consistency, variant consistency, and footprint mismatch checks.
- Pinmap format, collision, unmapped pin, and net label checks.
- Manufacturing output, drill coverage, fab note, panel sanity, layer stackup, and jobset checks.
- Design outline and copper balance checks.
- Release revision, version format, tag, and changelog checks.

## Local Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run docs
```

The repository intentionally versions `dist/action/index.cjs` and `dist/cli/index.cjs` so the GitHub Action and npm package can run without a consumer build step.

## Roadmap

BoardReadyOps is evolving from a validation gate into a full hardware release OS. See [docs/ROADMAP.md](docs/ROADMAP.md) for the milestone plan and [issue #260](https://github.com/oaslananka/boardreadyops/issues/260) for the tracking issue.

## Links

- Repository: <https://github.com/oaslananka/boardreadyops>
- Issues: <https://github.com/oaslananka/boardreadyops/issues>
- Roadmap: <https://github.com/oaslananka/boardreadyops/issues/260>
- Security advisories: <https://github.com/oaslananka/boardreadyops/security/advisories/new>

## License

MIT. Third-party notices are generated in `NOTICE`. The full container image
redistributes KiCad under GPL terms and preserves the KiCad license text inside
the image.
