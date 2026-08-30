# Copy-Paste Documentation Audit

BOARD-57 verifies that public instructions are either executable as written,
documented as placeholders, documented as release-operator procedures, or
explicitly blocked by a tracked follow-up issue.

## Current Supersession (2026-06-19)

This page records the original BOARD audit target below. The current public
channel state is superseded by `boardreadyops@1.37.0` and GitHub Release
`v1.37.0`: npm clean-consumer install, Linux x64 release binary
checksum/runtime smoke, release asset publication, Homebrew formula checksum
data, and anonymous GHCR `v1`/`latest` manifest access are verified in
[Release Channel Verification](channel-verification.md). Keep the historical
rows below for traceability; do not use their `v1.0.2` channel limitations as
the current release state.

## Audit Target

| Field | Value |
| --- | --- |
| Audit date | 2026-05-26 Europe/Istanbul |
| Base git ref | `4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0` |
| Branch | `codex/BOARD-57-copy-paste-docs-gate` |
| Package version | `1.0.2` |
| Public release reference | `v1.0.2` |
| Current action example reference | `oaslananka/boardreadyops@4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0 # current action contract` |

## Audited Pages

| Surface | Pages |
| --- | --- |
| README and quickstart | `README.md`, `docs/index.md`, `docs/quickstart.md` |
| Installation channels | `docs/install.md`, `docs/release/channel-verification.md` |
| GitHub Actions and containers | `docs/action.md`, `docs/github-action.md`, `docs/integrations/github-code-scanning.md` |
| CLI and troubleshooting | `docs/cli.md`, `docs/development/debugging.md`, `docs/testing.md`, `docs/accessibility.md` |
| Configuration and workspaces | `docs/configuration.md`, `docs/cross-platform.md`, `docs/multi-project.md` |
| KiCad and integrations | `docs/integrations/kicad-ipc.md`, `docs/integrations/boardreadyops-mcp.md`, `docs/integrations/boardreadyops-studio.md` |
| Extension and vendor hooks | `docs/plugin-sdk.md` |
| Report formats and SBOM | `docs/reports/*.md`, `docs/sbom.md` |
| Rule reference | `docs/rules/*.md` |
| Release and governance | `docs/release/*.md`, `docs/governance.md` |
| Compatibility matrix | `docs/support-matrix.md`, `docs/compatibility.yaml` |

## Executed Consumer Commands

These commands were executed from clean temporary directories or isolated
prefixes during the audit.

| Command family | Result |
| --- | --- |
| `npm view boardreadyops@1.0.2 version dist.integrity dist.tarball dist.shasum engines bin --json` | Pass. npm returned version `1.0.2`, tarball `https://registry.npmjs.org/boardreadyops/-/boardreadyops-1.0.2.tgz`, integrity `sha512-RVh0xOUWT0dO9ST0sN8NtUXPc62YsInz1ANL4kE1f/EG79vX4pf/sDGn9uMgXr1A7zL5oBFDA++rQQVAs98JuA==`, and public package engine `>=24 <25`. |
| `npm install --global boardreadyops@1.0.2` with a temporary prefix | Pass. `boardreadyops --version` returned `1.0.2`; `boardreadyops --help` listed the expected command families. |
| `boardreadyops init` from the temporary global install | Pass. The command created `boardreadyops.yml` in a clean consumer directory. |
| `npx -y boardreadyops@1.0.2 --help` from a clean non-repository directory | Pass. The public package executed without resolving the local workspace package. |
| `docker manifest inspect ghcr.io/oaslananka/boardreadyops-full:v1` | Fail as expected for the current public channel. GHCR returned `denied`; BOARD-64 owns publishing an anonymous-pullable image and digest. |
| `BOARDREADYOPS_VERSION=1.0.2 sh ./install.sh` | Fail as expected for the current public channel. The installer exited `22` after GitHub returned HTTP 404 for missing release assets. BOARD-63 owns binary assets and checksums. |
| `BOARDREADYOPS_VERSION=1.0.2 ./install.ps1` under PowerShell | Fail as expected for the current public channel. The installer exited `1` after GitHub returned HTTP 404 for missing release assets. BOARD-63 owns Windows binary assets and checksums. |
| `npm view @boardreadyops/plugin-sdk version dist.tarball engines --json` | Fail as expected for the current public channel. npm returned 404 because the SDK package is repository-local and not published as a standalone package yet. The Plugin SDK page now documents local workspace or file dependencies instead of presenting this as a public install. |

## Executed Local Commands

These command forms were executed against the committed local CLI bundle and
temporary fixture copies, without mutating the repository checkout.

| Command family | Result |
| --- | --- |
| `node dist/cli/index.cjs --version` and `--help` | Pass. Version output was `1.0.2`. |
| `doctor`, `doctor --check repository`, `doctor --format json`, and `schema doctor` | Pass. The JSON doctor report parsed successfully and exposed six check items. |
| `schema hbom` | Pass. The HBOM schema printed valid JSON Schema content. |
| `check`, `check <rule-id>`, and `run` with `--project`, explicit JSON, SARIF, Markdown, `--fail-on never`, and `--no-annotations` | Pass against the `safe-basic` fixture copy. Generated findings were empty and `failed` was `false`. |
| `run` with `--concurrency 2` | Pass against the same fixture copy. |
| `sbom` with `--output <file>` and `--output -` | Pass. The generated HBOM used `bomFormat: CycloneDX`, `specVersion: 1.7`, `metadata.component.type: device`, and one component for the fixture BOM. |
| `fix --dry-run` and `fix --rule bom.missing-mpn --dry-run` | Pass against a temporary fixture copy. No repository files were changed. |
| `baseline capture`, `baseline show`, `baseline diff`, `baseline prune`, and `baseline clear` with a temporary config path | Pass against a temporary fixture copy. Baseline files were created and removed only under `/tmp`. |
| `BOARDREADY_LOCALE=tr boardreadyops doctor` and `BOARDREADY_LOCALE=tr boardreadyops run ... --markdown -` | Pass. Locale examples now include Windows 11 PowerShell equivalents where the environment syntax differs. |
| `zip` packaging for `kicad-plugin/` | Retired. `kicad-plugin/` was removed in commit `68e21df`. |

## Intentionally Illustrative Blocks

| Block | Classification |
| --- | --- |
| GitHub workflow YAML examples | Copy-paste workflow templates. They are not executed directly as shell commands; action references are SHA-pinned and checked by the action pin script. |
| Container action YAML in README and `docs/github-action.md` | Illustrative only while BOARD-64 is open. The placeholder SHA must not be pasted into production workflows. |
| Direct `docker run ghcr.io/oaslananka/boardreadyops-full:v1 --help` | Intended final command shape, but blocked until BOARD-64 resolves the anonymous GHCR manifest denial. |
| Binary installer commands in README and `docs/install.md` | Intended final command shape, but blocked until BOARD-63 publishes binary release assets and `SHA256SUMS`. |
| Homebrew formula guidance | Template-only until BOARD-63 publishes release checksums. |
| KiCad plugin command with `<project-directory>`, `<active.kicad_pro>`, and `<temporary-json-report>` | Runtime process shape, not literal shell text. The page now labels the placeholders. |
| CLI examples using `hardware/mainboard` and similar paths | Placeholder paths for a real KiCad workspace. Equivalent command shapes were executed against fixtures. |
| Baseline examples using `[path] [--config <path>]` | Syntax reference. The page now labels bracketed arguments as placeholders. |
| Branch protection helper commands | Maintainer-owned repository settings operations, not normal contributor or agent steps. |
| Release tag, GitHub Release, npm publish, signing, and attestation snippets | Release-operator procedures only. They were intentionally not executed by this audit. |
| Rule reference JSON detail shapes | Data-shape documentation, not shell commands. Generated rule docs rebuild from source metadata. |

## Version And Freshness Evidence

| Surface | Evidence |
| --- | --- |
| Public npm package | `boardreadyops@1.0.2` exists and publicly reports Node engine `>=24 <25`; docs avoid claiming that public package supports Node 22. |
| Repository runtime support | `package.json` supports `^22.0.0 || ^24.0.0`; generated `docs/support-matrix.md` lists Node 22 and Node 24 with Node 24 recommended. |
| Public GitHub release | `v1.0.2` resolves to commit `9210bcaea20bdc99f8cd26c6c4b62cbf4ad7983e` and has an empty asset list. |
| Current GitHub Action examples | README, `docs/action.md`, and `docs/sbom.md` pin `4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0`, which matches the current `action.yml` inputs documented on this site. |
| KiCad plugin | Retired. `kicad-plugin/` was removed in commit `68e21df`. |
| CycloneDX HBOM | Local CLI generated CycloneDX `1.7` JSON and `schema hbom` printed the repository schema. |
| Container channel | GHCR anonymous manifest lookup for `ghcr.io/oaslananka/boardreadyops-full:v1` returned `denied`; docs keep the channel blocked on BOARD-64. |

## Completion Rule

BOARD-57 is complete when this audit page, public docs, generated docs, and
validation output agree: executable commands have evidence, unsupported public
channels are linked to BOARD-63, BOARD-64, or BOARD-65, and placeholder or
operator-only snippets are explicitly classified instead of presented as
current copy-paste commands.
