# Release Channel Verification

This page records clean-consumer verification evidence for the public
BoardReadyOps consumption channels. The current contract is version-derived and
kept synchronized by `release:readme`; timestamped verification snapshots are
immutable evidence and are not rewritten by release bumps.

> **Current status:** The latest public release is `boardreadyops@1.30.1` on npm
> and the `v1.30.1` GitHub Release. The exact release tag and floating `v1` tag
> point to the same reviewed release commit. Stable GHCR aliases are expected to
> resolve to the same multi-architecture image index.

## Current Release Contract

| Surface | Current contract |
| --- | --- |
| Public release | `v1.30.1` |
| npm package | `boardreadyops@1.30.1` (`latest`) |
| Binary assets | Linux x64/arm64, macOS x64/arm64, Windows x64, `SHA256SUMS`, and `sbom.cyclonedx.json` |
| Root Action | Pin a reviewed release commit SHA for reproducibility; `v1` is a moving convenience alias |
| Container Action | Pin the same reviewed release commit SHA; its image aliases are release-managed |
| Container aliases | `v1.30.1`, `v1`, and `latest` |
| Homebrew formula | Repository formula must use the exact release version and `SHA256SUMS` values; external tap publication is a separate maintainer concern |

Run the deterministic repository freshness check on every change:

```bash
corepack pnpm run verify:public-surface
```

For a live public-channel audit after publication, run:

```bash
BOARDREADY_VERIFY_PUBLIC_CHANNELS=1 corepack pnpm run verify:release-channels
```

## Verified Public Snapshot — v1.30.1 (2026-08-07)

The following evidence was re-read from the public channels on 2026-08-07. It
is intentionally a timestamped snapshot rather than a mutable source of truth.

| Field | Verified value |
| --- | --- |
| Release tag commit | `884f5fa31f8fd701693c533747c69eb7d13f5464` |
| Floating `v1` tag commit | `884f5fa31f8fd701693c533747c69eb7d13f5464` |
| Recommended immutable root/container Action pin | `884f5fa31f8fd701693c533747c69eb7d13f5464` (`v1.30.1`) |
| npm integrity | `sha512-e3jI4/cdXC30v8LlKYy0VCCU3Uu0DNLpnvL1k4lIaBfRiYMzbsIGjUviU/jihTQb8KTocEDJJvptwrkrA3UPPA==` |
| npm shasum | `2ae9023901c2ca41ad08771e14a4fb361b1db8d1` |
| npm engines | `^22.14.0 || ^24.0.0` |
| GitHub Release | Published 2026-08-05; non-draft and non-prerelease |
| Release assets | Seven expected assets are present |
| `SHA256SUMS` digest | `sha256:90be0ca72010506a3b895db251130ff0708eed120fb2f6a969a55018ebae1ee8` |
| `sbom.cyclonedx.json` digest | `sha256:4850654f935fccfed965ef47f4b0d66433e5be69d5b0f682542d4011bee834ea` |
| Anonymous GHCR index | `sha256:4df163600bd03126f072a5870db33f72db9991bf932fe275b5858e54f73fc650` |
| GHCR linux/amd64 manifest | `sha256:7e3bdc889fb0a0e9555b88c0271eabd7eb7a9b28999a9d003dc1f253e5d03242` |
| GHCR linux/arm64 manifest | `sha256:6f750af4eafb6ec92d50f3990bb1f4d6e96cd33a6c627aa4654e57e649ab8483` |

### v1.30.1 Verification Matrix

| Channel | Result | Evidence |
| --- | --- | --- |
| npm metadata | Pass | Registry version and `latest` both resolve to `1.30.1`; the published engines match the repository contract. |
| npm clean consumer | Pass | `npm exec --package=boardreadyops@1.30.1 -- boardreadyops --version` returned `1.30.1` from a temporary non-repository directory. |
| GitHub Release | Pass | `v1.30.1` targets the verified release commit and exposes exactly seven expected assets with SHA-256 digests. |
| Linux x64 binary | Pass | The downloaded asset matched its `SHA256SUMS` entry and `--version` returned `1.30.1`. |
| Action pin | Pass | The `v1.30.1` release commit is Verified and the current `action.yml`, container Action metadata, and Action input contract have not changed since that release. |
| GHCR aliases | Pass | Anonymous `docker buildx imagetools inspect` resolved `v1.30.1`, `v1`, and `latest` to the same OCI index with linux/amd64 and linux/arm64 manifests. |
| Homebrew formula | Pass for repository formula | Version and four macOS/Linux checksums match the `v1.30.1` release. External tap publication was not asserted. |

### v1.30.1 Release Artifact List

| Artifact | SHA-256 |
| --- | --- |
| `boardreadyops-linux-x64` | `c1515abbdafab8e46e63feb65e3c9899babf51e256a4e8ed128046539bd1b520` |
| `boardreadyops-linux-arm64` | `a546c1a4339b32f26000c916471fb8f5dfc007c47ff4c88116a28356f213eca8` |
| `boardreadyops-macos-x64` | `411b083dd6c2ab675404cdd8e5f62d1c1371b4b3e5825c8409ed0464514c4034` |
| `boardreadyops-macos-arm64` | `6f9d1d9f3cc04c4380f7ccfb8ccecd58bf9ea8c4b473f2b78b39308ef9c1ba7f` |
| `boardreadyops-win-x64.exe` | `36ec06910e51b4b0557eedb14740b470327523ec3614fd8f55f4a60d9744d61b` |
| `SHA256SUMS` | `90be0ca72010506a3b895db251130ff0708eed120fb2f6a969a55018ebae1ee8` |
| `sbom.cyclonedx.json` | `4850654f935fccfed965ef47f4b0d66433e5be69d5b0f682542d4011bee834ea` |

## Historical Audit Target

| Field | Value |
| --- | --- |
| Audit date | 2026-05-28 |
| Public release | `v1.1.0` |
| Release URL | <https://github.com/oaslananka/boardreadyops/releases/tag/v1.1.0> |
| Release tag commit | `41856e44bb2fc5def47a71072eccdad307301fc4` |
| npm package | `boardreadyops@1.1.0` |
| npm tarball | `https://registry.npmjs.org/boardreadyops/-/boardreadyops-1.1.0.tgz` |
| npm integrity | `sha512-fN0zRcKP1/fqW0/wYknBr+nh5HhZ7udpcfZoSqyNuRvinCdmvbQO9kOz/yG4KrqeHSzXuk0iMT5Fuw/YtchngQ==` |
| npm shasum | `c358e9cc8dd4cb5d63e466d1602cd901ad62d24b` |
| npm engines for public package | `^22.0.0 || ^24.0.0` |
| GHCR image index | `ghcr.io/oaslananka/boardreadyops-full:v1.1.0@sha256:5258e7de0e25382894c70164e990820f78a7fdfce92453932e2f75d51728934b` |
| Audit hosts | Windows 11 with Node.js `v24.18.0` and KiCad CLI `10.0.3`; Docker Linux probes with `node:22-bookworm-slim` and `node:24-bookworm-slim` |

## Pass/Fail Matrix

| Channel | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| npm metadata | Pass | `npm view boardreadyops@1.1.0` reports version `1.1.0`, `latest` dist-tag `1.1.0`, engines `^22.0.0 || ^24.0.0`, CLI bin `dist/cli/index.cjs`, and the integrity listed above. | None |
| npm clean install on Windows 11 | Pass | A temporary prefix install ran `boardreadyops --version`, `boardreadyops doctor --format json`, `boardreadyops schema config`, and `boardreadyops check . --fail-on never` from a separate consumer directory. JSON, SARIF, Markdown, HTML, and JUnit reports were generated. | None |
| npm clean install on Linux, Node 24 | Pass | `node:24-bookworm-slim` installed `boardreadyops@1.1.0`, reported Node `v24.18.0`, npm `11.13.0`, CLI version `1.1.0`, valid doctor JSON check groups, schema entries for `html` and `junit`, and all five report outputs. | None |
| npm clean install on Linux, Node 22 | Pass | `node:22-bookworm-slim` installed `boardreadyops@1.1.0`, reported Node `v22.22.3`, npm `10.9.8`, CLI version `1.1.0`, valid doctor JSON check groups, and all five report outputs. | None |
| npm tarball contents | Pass (historical) | `npm pack boardreadyops@1.1.0` produced `boardreadyops-1.1.0.tgz` with `dist/`, `schemas/`, `docs/`, `action.yml`, and `kicad-plugin/metadata.json`, plugin Python files, and icon resources. `kicad-plugin/` has since been retired (commit `68e21df`). | None |
| Public tag archive contents | Pass (historical) | `git ls-tree -r --name-only v1.1.0 -- kicad-plugin` lists `metadata.json`, `plugins/__init__.py`, `plugins/boardreadyops_plugin.py`, and `resources/icon.png`. `kicad-plugin/` has since been retired. | None |
| Public package parity with current docs | Pass | The public package accepts `boardreadyops doctor --format json`, accepts `report.html` and `report.junit.xml` in config, generates JSON, SARIF, Markdown, HTML, and JUnit reports. `kicad-plugin/` was included at `v1.1.0` and has since been retired from main. | None |
| GitHub Release binary asset list | Pass | `gh release view v1.1.0` lists Linux x64, Linux arm64, macOS x64, macOS arm64, Windows x64, `SHA256SUMS`, and `sbom.cyclonedx.json` assets. | [BOARD-63](https://linear.app/oaslananka/issue/BOARD-63/completion-follow-up-publish-binary-release-assets-and-homebrew) for installer OS matrix and Homebrew checksums. |
| GHCR full container image | Partial | Manual `container-build` run `26543611642` published `v1.1.0`, `v1`, and `latest` to the same OCI index digest `sha256:5258e7de0e25382894c70164e990820f78a7fdfce92453932e2f75d51728934b`; `docker buildx imagetools inspect` shows `linux/amd64` and `linux/arm64`; a runtime probe returned BoardReadyOps `1.1.0` and KiCad CLI `10.0.3`. | [BOARD-64](https://linear.app/oaslananka/issue/BOARD-64/completion-follow-up-make-ghcr-container-image-anonymously-pullable) for explicit anonymous logout validation and clean container Action workflow evidence. |
| Homebrew formula | Partial | `Formula/boardreadyops.rb` still contains fail-closed checksum placeholders. | [BOARD-63](https://linear.app/oaslananka/issue/BOARD-63/completion-follow-up-publish-binary-release-assets-and-homebrew) |
| KiCad PCM publication | Retired | The `kicad-plugin/` package was present in npm and the tag archive at `v1.1.0` but was removed from main in commit `68e21df`. The PCM plugin integration test and CLI profile have been retired. KiCad PCM distribution is no longer planned. | None |

## Tested Release Artifact List

| Artifact | Status |
| --- | --- |
| `boardreadyops@1.1.0` npm package | Present and clean-consumer tested on Windows 11 plus Linux Node 22 and 24 |
| `oaslananka/boardreadyops@41856e44bb2fc5def47a71072eccdad307301fc4` root action | Present in public tag archive |
| GitHub Release `v1.1.0` assets | Seven assets present: five binaries, `SHA256SUMS`, and `sbom.cyclonedx.json` |
| `boardreadyops-linux-x64` | Present, digest `sha256:d0d07dd0d34e1bf2f748449d7603345b9533068cb6730bf5a52cd432f1805e65` |
| `boardreadyops-linux-arm64` | Present, digest `sha256:664c52b4ab8a31e34a21b9e0fb5c5968a5ab0915826ee949286f462d281a09c1` |
| `boardreadyops-macos-x64` | Present, digest `sha256:1bd9e914f848ee0086c5cd3e2823117e28f5b3409a766ed0c6cfa7a736ffb2f0` |
| `boardreadyops-macos-arm64` | Present, digest `sha256:8b28c9d68d02390b8873b788efd0d94cd06c92a9dc956cff596de6b2fdc7ae85` |
| `boardreadyops-win-x64.exe` | Present, digest `sha256:e849be5213b1c1973c36d424a487a325b3e69e6744cff43e89c9120f3a6ce7fe` |
| `SHA256SUMS` | Present, digest `sha256:71657f4731259c30354f7d22fc841d03a321fc522020776a1c1ed9903a7129e0` |
| `sbom.cyclonedx.json` | Present, digest `sha256:c42813ec33eff55f0a267cdb38f8245ea51cd3f256acf53c56ea8e9ac4428eb9` |
| `ghcr.io/oaslananka/boardreadyops-full:v1.1.0` | Present, OCI index digest `sha256:5258e7de0e25382894c70164e990820f78a7fdfce92453932e2f75d51728934b` |
| `ghcr.io/oaslananka/boardreadyops-full:v1` | Present, same OCI index digest as `v1.1.0` |
| `ghcr.io/oaslananka/boardreadyops-full:latest` | Present, same OCI index digest as `v1.1.0` |
| `Formula/boardreadyops.rb` | Template only; checksum placeholders remain |
| `kicad-plugin/` public package artifact | Retired. Present at `v1.1.0`; removed from main in commit `68e21df`. |

## Terminal Transcript Summary

```text
$ npm view boardreadyops@1.1.0 version dist-tags engines bin dist.tarball dist.integrity --json
version: 1.1.0
dist-tags.latest: 1.1.0
engines.node: ^22.0.0 || ^24.0.0
bin.boardreadyops: dist/cli/index.cjs
integrity: sha512-fN0zRcKP1/fqW0/wYknBr+nh5HhZ7udpcfZoSqyNuRvinCdmvbQO9kOz/yG4KrqeHSzXuk0iMT5Fuw/YtchngQ==
```

```text
$ npm pack boardreadyops@1.1.0
filename: boardreadyops-1.1.0.tgz
shasum: c358e9cc8dd4cb5d63e466d1602cd901ad62d24b
total files: 106
included: package/dist/action/index.cjs, package/dist/cli/index.cjs,
package/schemas/config.schema.json, package/docs/release/channel-verification.md,
package/action.yml
```

```text
$ boardreadyops --version
1.1.0
$ boardreadyops doctor --format json
tool.version: 1.1.0
checks: runtime,kicad,adapters,repository,suppressions,action
$ boardreadyops check . --fail-on never
generated: findings.json, findings.sarif.json, report.md, report.html, report.junit.xml
```

```text
$ docker buildx imagetools inspect ghcr.io/oaslananka/boardreadyops-full:v1.1.0
Digest: sha256:5258e7de0e25382894c70164e990820f78a7fdfce92453932e2f75d51728934b
Platforms: linux/amd64, linux/arm64
$ docker run --rm --entrypoint boardreadyops ghcr.io/oaslananka/boardreadyops-full:v1.1.0 --version
1.1.0
$ docker run --rm --entrypoint kicad-cli ghcr.io/oaslananka/boardreadyops-full:v1.1.0 version
10.0.3
```

```text
$ gh run view 26543611642
workflow: container-build
conclusion: success
jobs: smoke (KiCad 9.0, Node 22.22.3), smoke (KiCad 10.0, Node 24.18.0), publish
artifact: boardreadyops-full-cyclonedx
```

## Completion Rule

The current public surface is considered synchronized only when the deterministic
`verify:public-surface` check passes and the live public-channel verifier confirms
that npm `latest`, the GitHub Release/tag, expected release assets and digests,
the reviewed immutable Action pin, and GHCR stable aliases agree. Timestamped
historical audits and verified snapshots remain unchanged for traceability.
