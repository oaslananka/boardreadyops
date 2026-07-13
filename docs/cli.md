# CLI

`boardreadyops run [path]` runs the full pipeline. `boardreadyops check [path]` is the concise preflight form for local and CI use. `boardreadyops check <rule-id> [path]` runs one rule. `boardreadyops fix [path]` plans and applies safe automated fixes. `boardreadyops generate [path]` produces first-party KiCad manufacturing outputs. `boardreadyops sbom [path]` emits a CycloneDX hardware SBOM from the captured fabrication BOM. `boardreadyops explain <rule-id> [path]` prints rule-specific diagnostics when that rule exposes an explainer. `doctor`, `schema`, `vendor`, and `init` support setup and automation.

Use `--project <path>` with `run` or `check` to restrict a workspace scan to one project directory or `.kicad_pro` file. Use `--concurrency <count>` to cap concurrent project execution when a workspace contains multiple boards.

The paths in these examples are placeholders for a real KiCad project in the
current workspace. The same command forms were smoke-tested with repository
fixtures during the BOARD-57 copy-paste audit.

```bash
boardreadyops run . --project hardware/mainboard
boardreadyops check manufacturing.outputs-present . --project hardware/mainboard
boardreadyops run . --concurrency 2
```

Use `boardreadyops run --gate release` to select a configured gate from `boardreadyops.yml`. A selected gate enforces its configured threshold and named requirements for local release checks; GitHub Action runs auto-detect `pull_request`, `main`, or `release` when the Action `gate` input is empty.

Use `--format json` with `run` or `check` when another tool should consume diagnostics from stdout. The JSON contract is described in [reports/json.md](reports/json.md) and validated by `schemas/findings.schema.json`. Human logs and annotations are written to stderr, so stdout remains parseable JSON even when the command exits nonzero for findings, configuration, or required-environment failures.

## Self-hosted runner operations

`boardreadyops runner` provides the customer-worker lifecycle for the self-hosted execution plane.

A trusted control-plane administrator issues a one-time enrollment token directly to a root-only file:

```bash
boardreadyops runner issue-enrollment \
  --database-url-file /run/secrets/boardreadyops-database-url \
  --installation-id 11111111-1111-4111-8111-111111111111 \
  --name factory-runner-01 \
  --scope repository \
  --repository octo-org/private-board \
  --token-output /secure-transfer/factory-runner-01.token
```

The customer host activates an Ed25519 identity without sending the generated private key to the control plane:

```bash
boardreadyops runner activate \
  --url https://boardreadyops.example.com \
  --enrollment-token-file /secure-transfer/factory-runner-01.token \
  --identity-dir /var/lib/boardreadyops-runner/identity \
  --capability kicad:10 \
  --capability linux-x64
```

Process one queue item during commissioning, or run the polling service continuously:

```bash
boardreadyops runner once \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces

boardreadyops runner serve \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces \
  --heartbeat-seconds 30 \
  --poll-seconds 15 \
  --format json
```

The worker accepts only `customer_checkout` assignments, fetches the exact server-assigned SHA with customer-controlled Git credentials or a local mirror, uploads only generated reports, and removes the temporary workspace by default. See [Self-hosted runner mode](deployment/self-hosted-runner.md) for the trust boundary, permissions, network policy, service configuration, private-repository evidence, updates, and rollback.

## Agent planning

`boardreadyops plan [path]` emits an agent-ready JSON remediation plan. It runs the validation pipeline and converts each finding into an action with evidence, a fix strategy, a safe-auto-fix flag, and commands an agent should run after changing files. Use it when a coding agent, EDA agent, review bot, or release workflow needs deterministic next steps without scraping human-oriented reports. See [Agent Planning Output](agent-planning.md).

```bash
boardreadyops plan .
boardreadyops plan . --config boardreadyops.yml > build/agent-plan.json
boardreadyops plan . --fail-on medium
```

The command exits `0` when the plan has no blocking findings and `1` when blocking findings or configuration diagnostics are present. stdout is always JSON; logs go to stderr. Validate consumers with `boardreadyops schema agent-plan`.

## Release evidence bundles

`boardreadyops release pack [path]` runs the pipeline and writes a verifiable evidence directory with a structured release record (`manifest.json`, schema version 2): a pass/fail decision, reports, copied manufacturing artifacts, optional generated outputs, checksums, Git metadata, optional provenance links, and explicit evidence gaps. Pass `--include-generated <dir>` to fold generated outputs into the bundle. `boardreadyops release verify [bundle]` recomputes artifact digests from `manifest.json` and fails if any recorded artifact has changed or is missing. See [release/evidence-bundles.md](release/evidence-bundles.md) for the full manifest contract.

```bash
boardreadyops release pack . --output build/boardreadyops-release
boardreadyops release pack . --include-generated build/outputs
boardreadyops release verify build/boardreadyops-release
boardreadyops release verify build/boardreadyops-release --format json
```

## Release signing

`boardreadyops release sign [bundle] --key <private-key>` signs the bundle's `manifest.json` with an Ed25519 private key and writes a `manifest.sig` sidecar (algorithm, manifest digest, signature, and the embedded public key). Because the manifest records the SHA-256 of every artifact, signing the manifest covers the whole bundle. `boardreadyops release verify [bundle] --public-key <public-key>` then requires a valid signature in addition to recomputing artifact digests, and pins the embedded key to the trusted public key you pass. See [release/evidence-bundles.md](release/evidence-bundles.md#signing-and-provenance) for the trust model.

```bash
# Generate an Ed25519 keypair once (kept out of the repository):
openssl genpkey -algorithm ed25519 -out release-signing.key
openssl pkey -in release-signing.key -pubout -out release-signing.pub

boardreadyops release pack . --output build/boardreadyops-release
boardreadyops release sign build/boardreadyops-release --key release-signing.key
boardreadyops release verify build/boardreadyops-release --public-key release-signing.pub
```

`release verify` exits `1` when a `--public-key` is supplied but the bundle is unsigned, when the signature does not match the manifest, or when the embedded key differs from the trusted key. Without `--public-key`, an unsigned bundle still verifies on checksums alone.

## Release preparation

`boardreadyops release prepare [path]` runs a single end-to-end preparation workflow: it generates first-party manufacturing outputs (when `kicad-cli` is available), validates the project with the full pipeline, and records a release decision. Results are written to `release-prepare.json` under the output directory (`build/boardreadyops-release` by default), and the command exits `0` for a `pass` decision and `1` for a `fail`.

```bash
boardreadyops release prepare .
boardreadyops release prepare . --variant production --output build/release
boardreadyops release prepare . --skip-generate --format json
boardreadyops release prepare . --require-kicad
```

The generation stage is best-effort by default: when `kicad-cli` is not installed it is reported as `skipped` and the workflow still validates and decides, which keeps the command usable in GitHub Actions runners that do not provide KiCad. Pass `--require-kicad` to fail with exit code `3` when `kicad-cli` is missing, or `--skip-generate` to validate without generating. The decision is `pass` only when validation reports no blocking findings and no generation step failed.

## Manufacturer handoff

`boardreadyops release handoff [path]` assembles a clean, vendor-specific package for fabrication and assembly handoff. It lays discovered manufacturing outputs into a stable directory structure, writes a receiver `README.md` and a `handoff-manifest.json`, and reports any outputs the selected vendor profile requires but that are missing. The JLCPCB profile is the default; exit code is `1` when required outputs are missing and `0` otherwise. See [release/manufacturer-handoff.md](release/manufacturer-handoff.md).

```bash
boardreadyops release handoff . --profile jlcpcb --output build/boardreadyops-handoff
boardreadyops release handoff . --profile pcbway --service fabrication
boardreadyops release handoff . --format json
```

## Release diff

`boardreadyops release diff <previous> [path]` compares the current project against a previous release — a prior JSON report or an evidence bundle directory — and reports the BOM, output/CPL, finding, and [readiness](release/readiness-scoring.md) changes between them. Use `--html <path>` to write a visual release dashboard that renders the fabrication changes — BOM rows, manufacturing outputs, and new findings — with color-coded status badges. See [release/release-diff.md](release/release-diff.md).

```bash
boardreadyops release diff build/previous-release.report.json .
boardreadyops release diff build/boardreadyops-release --format json --output build/release-diff.json
boardreadyops release diff build/previous-release.report.json . --html build/release-diff.html
```

## Policy

`boardreadyops policy [path]` evaluates the configured release policy (a set of blocking rules over findings and [readiness](release/readiness-scoring.md)) and, when the policy is enforced, exits `1` if it fails. Use `--simulate` to preview a policy without affecting the exit code. See [release/policy-engine.md](release/policy-engine.md).

```bash
boardreadyops policy .
boardreadyops policy . --simulate
boardreadyops policy . --format json
```

```yaml
# .github/workflows/release-prepare.yml
jobs:
  release-prepare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - run: npx boardreadyops release prepare . --format json
```

## Vendor Profiles

`boardreadyops vendor list` shows the built-in manufacturer profiles. `boardreadyops vendor explain <profile>` prints the evidence requirements and assumptions for one profile. Use `--format json` when another tool should consume the profile data.

```bash
boardreadyops vendor list
boardreadyops vendor explain jlcpcb
boardreadyops vendor explain pcbway --format json
```

See [Vendor Profiles](vendor-profiles.md) for configuration examples.

## Generate

`boardreadyops generate [path]` runs `kicad-cli` to produce first-party manufacturing outputs and writes them, with a checksum manifest, to a predictable directory (`build/boardreadyops-generate` by default). Each enabled step exports one output kind: `gerbers` and `drill` from the board, `bom` and `schematic-pdf` from the schematic, and `positions` (CPL, CSV) and `board-pdf` from the board. Steps whose source file is missing are reported as skipped rather than failing the run.

```bash
boardreadyops generate .
boardreadyops generate . --project hardware/mainboard --variant production
boardreadyops generate . --recipe generate-recipe.json --output build/release-outputs
boardreadyops generate . --format json
```

The command exits `2` for usage or configuration problems (no project, unreadable or schema-invalid recipe), `3` when `kicad-cli` is not available, and `1` when at least one export step fails. `manifest.json` records the tool version, project, recipe, per-step status, and the SHA-256 digest and size of every generated artifact.

`--recipe <path>` accepts a JSON recipe validated against `boardreadyops schema generate`. The recipe selects which outputs to produce, lets a step be disabled with `"enabled": false`, and can override the output directory or a step's relative output path.

```json
{
  "schemaVersion": 1,
  "outputDir": "build/release-outputs",
  "steps": [
    { "kind": "gerbers" },
    { "kind": "drill" },
    { "kind": "bom", "output": "assembly/bom.csv" },
    { "kind": "positions" },
    { "kind": "schematic-pdf" },
    { "kind": "board-pdf", "enabled": false }
  ]
}
```

## Hardware SBOM

`boardreadyops sbom [path]` writes a CycloneDX 1.7 hardware SBOM to `build/hbom.json` by default. Use `--output -` when another process should read the JSON from stdout.

```bash
boardreadyops sbom .
boardreadyops sbom . --output build/hbom.json
boardreadyops sbom . --bom production-bom.csv --variant production
boardreadyops sbom . --output -
```

The command accepts `--config`, `--project`, `--bom`, and `--variant` to match the same project and BOM selection used by `run`. `--format cyclonedx` is the implemented format. `--format spdx` is reserved for a future release and exits with code `2`.

## Fix

`boardreadyops fix [path]` prints a diff for safe automated changes before it writes anything. By default it refuses to apply changes in a dirty Git workspace; use `--allow-dirty` only when the local edits are intentional and already reviewed.

```sh
boardreadyops fix .
boardreadyops fix . --dry-run
boardreadyops fix . --rule bom.missing-mpn
boardreadyops fix . --interactive
boardreadyops fix . --commit
boardreadyops fix . --drc-report build/kicad-drc.json --dry-run
```

Automated fixes cover inferable BOM MPN values, release changelog scaffolding, release revision normalization, missing PCB revision metadata, and missing fabrication notes. `bom.dnp-consistency` findings are surfaced but not applied automatically. KiCad DRC JSON diagnostics that include a suggested fix, or clearance wording that can be converted into a human review suggestion, are printed under `DRC suggested fixes` and do not mutate board files.

Use `fix.allow` in `boardreadyops.yml` to restrict which safe fix categories may be applied. `--rule` narrows a single invocation further.

## Logging

`run` and `check` emit command lifecycle logs through the shared logger. The default is text output at `info` level on stderr. Use JSON Lines when another tool ingests logs:

```bash
boardreadyops run . --log-format json --log-level debug --log-file build/boardreadyops.jsonl
```

Supported levels are `debug`, `info`, `warn`, `error`, `critical`, and `silent`. `--quiet` maps to `silent` unless `--log-level` or `BOARDREADY_LOG_LEVEL` is set; `--verbose` maps to `debug`. The equivalent environment variables are `BOARDREADY_LOG_LEVEL`, `BOARDREADY_LOG_FORMAT`, `BOARDREADY_LOG_FILE`, `BOARDREADY_LOG_FILE_MAX_BYTES`, and `BOARDREADY_LOG_FILE_RETENTION`.

Log records include stable fields such as `ts`, `level`, `event`, `session_id`, `rule`, and `latency_ms`. JSON log records redact secret-shaped values, replace the project root with `<project>`, and omit error stacks unless debug logging is enabled. File logs rotate by size with bounded retention:

```bash
boardreadyops check . \
  --log-file build/boardreadyops.log \
  --log-file-max-bytes 1048576 \
  --log-file-retention 3
```

## Locale

Human-facing CLI output uses English by default. For testing purposes, it can be switched to the pseudo-locale with `BOARDREADY_LOCALE=__PSEUDO__`. When `BOARDREADY_LOCALE` is unset, it defaults to English.

Linux and macOS shells can set the locale for one command:

```sh
BOARDREADY_LOCALE=__PSEUDO__ boardreadyops doctor
BOARDREADY_LOCALE=__PSEUDO__ boardreadyops run . --markdown -
```

Windows 11 PowerShell uses `$env:` assignment:

```powershell
$env:BOARDREADY_LOCALE = "__PSEUDO__"
boardreadyops doctor
boardreadyops run . --markdown -
Remove-Item Env:\BOARDREADY_LOCALE
```

The locale setting affects status lines, configuration and environment error prefixes, doctor text output, and Markdown/HTML report labels produced by the CLI. JSON, SARIF, JUnit, rule IDs, and finding messages remain locale-independent for automation and stable references.

## Doctor

`boardreadyops doctor` diagnoses the current environment and repository before a full pipeline run. Its checks cover the Node and npm runtime, KiCad CLI availability, configured adapter credentials, repository discovery and manufacturing outputs, suppression state, and the conventional `.github/workflows/boardreadyops.yml` or `.github/workflows/boardreadyops.yaml` workflow. Runtime support follows the [support matrix](support-matrix.md).

```sh
boardreadyops doctor
boardreadyops doctor --check repository
boardreadyops doctor --format json
boardreadyops schema doctor
```

`--check` accepts `runtime`, `kicad`, `adapters`, `repository`, `suppressions`, or `action`; unknown check names return exit code `2`. `--format` accepts only `text` and `json`, and unknown formats also return exit code `2`.

The JSON form returns structured check items with `pass`, `warn`, `fail`, or `info` severities plus deduplicated recommendations. `boardreadyops schema doctor` prints the JSON Schema for consumers that ingest the report.

## Baselines

Baseline commands operate on the configured baseline file, or `.boardreadyops-baseline.json` when the config does not override it.

The bracketed arguments below are syntax placeholders. Replace `[path]` and
`[--config <path>]` with a repository path and config flag, or omit them to use
the defaults.

```sh
boardreadyops baseline capture [path] [--config <path>]
boardreadyops baseline diff [path] [--config <path>]
boardreadyops baseline show [path] [--config <path>]
boardreadyops baseline prune [path] [--config <path>]
boardreadyops baseline clear [path] [--config <path>]
```

`capture` writes the current finding fingerprints. `diff` reports added, removed, and unchanged findings. `prune` removes entries that no longer match the current run. Each subcommand accepts an optional repository path and the same `--config <path>` lookup used by `run`, so non-default config files resolve the matching baseline file.
