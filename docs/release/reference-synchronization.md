# Reference Synchronization Gate

BOARD-60 verifies that public references, generated documentation, release version references, and documentation accessibility checks are synchronized before BoardReadyOps is treated as complete.

## Current Supersession (2026-06-19)

This page records the original BOARD audit target below. The current public
channel state is superseded by `boardreadyops@1.32.1` and GitHub Release
`v1.32.1`: npm clean-consumer install, Linux x64 release binary
checksum/runtime smoke, release asset publication, Homebrew formula checksum
data, and anonymous GHCR `v1`/`latest` manifest access are verified in
[Release Channel Verification](channel-verification.md). Keep the historical
rows below for traceability; do not use their `v1.0.2` channel limitations as
the current release state.

## Audit Target

| Field | Value |
| --- | --- |
| Audit date | 2026-05-26 Europe/Istanbul |
| Base git ref | `42a4a5d396914278c1e0f9e2c3bf47cd257a7052` |
| Branch | `codex/BOARD-60-reference-synchronization-gate` |
| Package version | `1.0.2` |
| Public release reference | `v1.0.2` |
| Current action example reference | `oaslananka/boardreadyops@4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0 # current action contract` |

## Surfaces Checked

| Surface | Status | Evidence |
| --- | --- | --- |
| README quickstart and release notes | Synchronized with known channel state | README points npm users at `boardreadyops@1.0.2`, documents Node.js 22/24 support for the current repo, and links unsupported public release channels to the release channel verification page. |
| GitHub Action examples | Synchronized with pinned references | README and generated `docs/action.md` use SHA-pinned `actions/checkout` and a current main BoardReadyOps action reference that matches the documented inputs. |
| Container action references | Synchronized as unavailable | README and `docs/github-action.md` keep the container path explicitly marked unavailable until GHCR anonymous pulls and digest evidence are fixed in BOARD-64. |
| Installation references | Synchronized with public release limitations | `docs/install.md` records npm success for `boardreadyops@1.0.2` and keeps binary/Homebrew install paths blocked on BOARD-63. |
| KiCad plugin reference | Retired | `kicad-plugin/` directory and `docs/kicad-plugin.md` were removed in commit `68e21df`; the PCM plugin integration test and `kicad-plugin` CLI profile were retired. No further KiCad PCM publication is planned. |
| Generated action inputs reference | Synchronized | `scripts/update-action-inputs-docs.mjs` regenerated `docs/action.md` without leaving a diff. |
| Generated rule references | Synchronized | `scripts/generate-rule-docs.mjs` regenerated `docs/rules/` without leaving a diff. |
| Support matrix | Synchronized | `scripts/compatibility.mjs render --check` passed against `docs/compatibility.yaml` and `docs/support-matrix.md`. |
| Documentation site | Synchronized | `scripts/docs-build.mjs` completed through `corepack pnpm run docs`. |
| Accessibility checks | Synchronized | `scripts/check-docs-a11y.mjs` scanned the built MkDocs site, including all 80 generated pages. |

## Validation Commands

| Command | Result |
| --- | --- |
| `PATH=/tmp/boardreadyops-docs-venv/bin:$PATH corepack pnpm run docs` | Pass |
| `corepack pnpm run docs:a11y` with the MkDocs virtualenv on `PATH` | Pass |
| `corepack pnpm run compatibility:check` | Pass |
| `ALLOW_MAJOR_RELEASE=true corepack pnpm run verify:version` | Pass |
| `node scripts/check-action-pins.mjs` | Pass |

The initial `docs:a11y` invocation failed when the MkDocs virtualenv path was applied only to the preceding command in the shell chain. Re-running with the same virtualenv exported in `PATH` passed; no source changes were needed for that environment issue.

## Release Reference Status

The repository and public release references intentionally remain split until follow-up release work is completed:

| Reference | Current status | Owner |
| --- | --- | --- |
| npm CLI `boardreadyops@1.0.2` | Public package exists and clean-consumer CLI smoke passed. | None |
| Root GitHub Action `v1.0.2` | Public tag action bundle was smoke-tested from the release commit, but current-contract examples use `4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0` so inputs such as `gate`, `hbom`, and logging flags match the docs. | None |
| Binary release assets and Homebrew checksums | Missing from public `v1.0.2`. | BOARD-63 |
| GHCR full container image | Anonymous manifest request denied for `ghcr.io/oaslananka/boardreadyops-full:v1`. | BOARD-64 |
| Public package parity with current docs, Node 22, and HTML report | Public package/tag archive lag current main. | BOARD-65 |
| Full copy-paste documentation audit | Recorded in [Copy-Paste Documentation Audit](copy-paste-audit.md). | BOARD-57 |

## Completion Rule

BOARD-60 is complete when generated references rebuild without drift, the strict docs site and accessibility checks pass, release/version references point at the current known public state, and remaining public channel limitations are linked to explicit follow-up issues instead of being hidden in examples.
