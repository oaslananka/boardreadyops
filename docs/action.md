# GitHub Action

```yaml
name: BoardReadyOps

on:
  pull_request:
  push:
    branches: [main]

jobs:
  boardreadyops:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops@4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0 # current action contract
        with:
          config: boardreadyops.yml
```

This example pins the current main Action commit because the input table below
is generated from the repository's current `action.yml`. The public
`v1.3.0` tag remains smoke-tested in the release channel matrix and includes
all current inputs.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `path` | `.` | Directory to scan. |
| `project` | `` | Explicit .kicad_pro path. If omitted, all discovered projects are scanned. |
| `config` | `boardreadyops.yml` | Path to boardreadyops.yml. |
| `mode` | `warn` | warn or enforce |
| `release-mode` | `` | Manufacturing release context. One of prototype, pilot, production. Empty disables release mode behavior. |
| `require-kicad` | `false` | Fail when kicad-cli is not available. |
| `kicad-cli` | `` | Explicit kicad-cli path. |
| `bom` | `auto` | BOM source path or "auto". |
| `pinmap` | `` | Pinmap file path. Empty disables pinmap rules. |
| `variant` | `` | KiCad variant name used by variant-aware BoardReadyOps rules. |
| `gate` | `` | Gate name from boardreadyops.yml. Empty auto-detects pull_request, main, or release. |
| `sarif` | `boardreadyops.sarif.json` | Output SARIF path. Empty disables. |
| `json` | `boardreadyops.findings.json` | Output JSON findings path. Empty disables. |
| `markdown` | `boardreadyops.report.md` | Output Markdown report path. Empty disables. |
| `hbom` | `` | Output CycloneDX hardware SBOM path. Empty disables. |
| `upload-sarif` | `true` | Upload SARIF to GitHub Code Scanning. |
| `upload-artifacts` | `true` | Upload reports as workflow artifacts. |
| `comment-pr` | `true` | Post a sticky Markdown comment on pull requests. |
| `comment-format` | `report` | Pull request comment style. One of report (full Markdown report) or review (compact release-review summary). |
| `artifact-name` | `boardreadyops` | Workflow artifact name. |
| `fail-on` | `high` | Severity threshold above which the action exits non-zero. One of critical, high, medium, low, never. |
| `annotations` | `true` | Emit ::error/::warning workflow annotations. |
| `log-level` | `info` | Log level. One of debug, info, warn, error, critical, silent. |
| `log-format` | `text` | Log format. One of text, json. |
| `log-file` | `` | Optional log file path inside the workspace. |
| `log-file-max-bytes` | `` | Rotate the log file after this many bytes. Empty uses the default. |
| `log-file-retention` | `` | Number of rotated log files to keep. Empty uses the default. |

## Outputs

| Name | Description |
| --- | --- |
| `findings` | Total finding count. |
| `critical` | Count of critical findings. |
| `high` | Count of high findings. |
| `medium` | Count of medium findings. |
| `low` | Count of low findings. |
| `sarif-path` | SARIF output path if produced. |
| `json-path` | JSON output path if produced. |
| `markdown-path` | Markdown output path if produced. |
| `hbom-path` | CycloneDX hardware SBOM output path if produced. |

## Pull request comments

When `comment-pr` is enabled, the sticky pull request comment summarizes the current findings. If the Action can read a previous BoardReadyOps JSON artifact from the pull request head branch or base branch, the comment also includes a fabrication diff for BOM rows, manufacturing outputs, and newly added findings.

## Notifiers

The Action honors the repository `notifiers` configuration from `boardreadyops.yml`. Webhook URLs, Telegram bot tokens, and SMTP credentials must be supplied through workflow environment variables or secrets referenced by the configured `webhookEnv`, `botTokenEnv`, or `smtpEnv` names. Delivery is best-effort: missing credentials, severity filters, and notifier failures do not change the Action exit code. Action notifications include a link to the current workflow run when GitHub exposes the run metadata.
