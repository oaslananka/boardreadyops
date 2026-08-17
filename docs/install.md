# Install

## npm

```bash
npm i -g boardreadyops
boardreadyops --help
boardreadyops doctor
```

The current public npm package is `boardreadyops@1.31.0`. It declares Node.js 22.14+
and 24 support, provides `boardreadyops doctor --format json`, accepts HTML and
JUnit report outputs in `boardreadyops.yml`, and ships the current docs,
schemas, and Action metadata.

For one-off use from a clean consumer directory:

```bash
npx -y boardreadyops@1.31.0 --help
```

## Binary Installers

The shell and PowerShell installers require a GitHub Release that contains the
platform binary asset and `SHA256SUMS`. The `v1.31.0` release contains the Linux,
macOS, and Windows binary matrix plus checksums.

```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.ps1 | iex
```

Pin a specific release during validation with `BOARDREADYOPS_VERSION`, for
example `BOARDREADYOPS_VERSION=1.31.0`. The Homebrew formula is populated with the `v1.31.0` macOS and Linux
checksums from `SHA256SUMS`; publishing a tap remains a maintainer follow-up.

## Homebrew

`Formula/boardreadyops.rb` is ready to copy into a tap once the tap repository
and maintainer process are chosen. It points at `v1.31.0` release binaries and
uses the macOS/Linux checksums recorded in that release's `SHA256SUMS`.

## Verification Status

The full clean-consumer verification matrix for npm, GitHub Action, binary
installers, Homebrew, GHCR, KiCad plugin packaging, and docs quickstart lives in
[Release Channel Verification](release/channel-verification.md).
