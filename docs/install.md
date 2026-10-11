# Install

## npm

```bash
npm i -g boardreadyops
boardreadyops --help
boardreadyops doctor
```

**Repository-prepared version:** `boardreadyops@1.68.3` reflects this checkout's
source candidate, **not proof of npm publication**. Confirm the current public
version at [npm](https://www.npmjs.com/package/boardreadyops). For a one-off
install of the latest published version:

```bash
npx -y boardreadyops@latest --help
```

For release-critical CI, resolve and pin the exact version you verified
instead of relying on a moving `latest` tag.

## Binary Installers

The shell and PowerShell installers require an actual
[GitHub Release](https://github.com/oaslananka/boardreadyops/releases) with
platform binary assets and matching `SHA256SUMS`. A version prepared in a
release PR may not exist yet.

```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.ps1 | iex
```

To pin a published release, set `BOARDREADYOPS_VERSION` to the version
confirmed on GitHub Releases. Never infer published assets from the repository's
prepared package version.

## Homebrew

`Formula/boardreadyops.rb` is a separately maintained formula and may lag
both source and published releases. Verify its embedded version and checksums
against the selected published tag before using or copying it into a tap.

## Verification Status

The full clean-consumer verification matrix for npm, GitHub Action, binary
installers, Homebrew, GHCR, KiCad plugin packaging, and docs quickstart lives in
[Release Channel Verification](release/channel-verification.md).
