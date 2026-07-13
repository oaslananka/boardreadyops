# Release Channel Verification

This page records clean-consumer verification evidence for the public
BoardReadyOps consumption channels. It is intentionally separate from the normal
release process so every unsupported public channel has a concrete follow-up
issue before completion is claimed.

> **Current status:** The latest public release is `boardreadyops@1.12.0` on npm
> and the `v1.12.0` GitHub Release. On 2026-07-13, npm metadata and a
> clean tarball CLI smoke, GitHub Release asset publication, Linux x64 binary
> checksum/runtime, and anonymous GHCR `v1.12.0`/`v1`/`latest` manifest and
> container runtime access were verified. The historical `v1.1.0` audit remains
> below for traceability.

## Current Release Verification (2026-07-13)

| Field | Value |
| --- | --- |
| Public release | `v1.12.0` |
| Release tag commit | `b9c22382638724778d0fa8bcbaab2c47665f5f67` |
| npm package | `boardreadyops@1.12.0` (`latest`) |
| npm integrity | `sha512-1teqYXjJwWK8p+xcMah1+fJ3uVLV9jPhgupR45x87XwsxXmZ/goe8zu5Ghw3EFV6+xMzqaIufWwR02cO6b/OCw==` |
| npm shasum | `383c4fb3c4ab8474853e2a9c80aab05270490e03` |
| npm engines | `^22.14.0 || ^24.0.0` |
| GitHub Release | Published 2026-07-13; non-draft and non-prerelease |
| GitHub Release assets | Seven assets: five platform binaries, `SHA256SUMS`, and `sbom.cyclonedx.json` |
| `SHA256SUMS` digest | `sha256:6a83d9a5fb92ff7d4714edf41725dc37484439238a301912187a1fd97ed25f38` |
| `sbom.cyclonedx.json` digest | `sha256:b2febbdd9b182d05f2ece8ff4b1ac07b99eea00b3198f411918eb47c14f5e67b` |
| Anonymous GHCR index | `sha256:dd3dda38785c3a1c79bc9e848946d575dd397c3b1c16fef5ac09f1b674fe3b4e` |
| GHCR exact and aliases | `v1.12.0`, `v1`, and `latest` resolve to the same OCI index digest |
| GHCR platforms | `linux/amd64` (`sha256:740be2e6da9beb9948a0ee9a28fc7c3c5af0ac3e3b79fd4ca99abc254d22c6ad`) and `linux/arm64` (`sha256:15d2f28c865b67825286c260d3066748443431dc819b9fd48b9d1f75fb00e266`) |
| Audit evidence | Temporary public-channel workflow run `29265858497` |

### Current Pass/Follow-up Matrix

| Channel | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| npm metadata and tarball smoke | Pass | Registry version and `latest` were `1.12.0`; the public tarball extracted successfully and `node package/dist/cli/index.cjs --version` returned `1.12.0`. | None |
| GitHub Release assets | Pass | `v1.12.0` targets the release commit and exposes exactly seven expected assets with GitHub-provided SHA-256 digests. | None |
| Linux x64 standalone binary | Pass | The downloaded binary matched `SHA256SUMS` and `./boardreadyops-linux-x64 --version` returned `1.12.0`. | Other platform binaries were smoke-tested by the release workflow but not downloaded by this independent audit. |
| GHCR exact and alias tags | Pass | Anonymous `docker buildx imagetools inspect` succeeded for `v1.12.0`, `v1`, and `latest`; all resolved to the same multi-architecture OCI index. | None |
| GHCR container runtime | Pass | An anonymous pull of `v1.12.0` succeeded and `boardreadyops --version` inside the container returned `1.12.0`. | None |
| Homebrew external tap | Not reverified | This audit did not inspect or publish an external tap. | Maintainer process. |

### Current Release Artifact List

| Artifact | SHA-256 |
| --- | --- |
| `boardreadyops-linux-x64` | `8359d1667f51bb5f67f4f7936056fd2db122b8c5e4d18a634730feeb64a27991` |
| `boardreadyops-linux-arm64` | `c8b59ab8b946dc4a5364bb0e11218a333b1b476f63d43cf1ca96ca1ccb40336e` |
| `boardreadyops-macos-x64` | `fbe73403ca4bb81965121fe298cf2a740e4ecfba8af711634a2dc4ffd4d55e7f` |
| `boardreadyops-macos-arm64` | `2dc528be637d8ee2549c33667b308250154039cd83e0c95c2845b1d7f63be488` |
| `boardreadyops-win-x64.exe` | `a7af60925d3c624955f1e59d1fccf83d1c7ecef4eafa8260f900c3c9bb1d1190` |
| `SHA256SUMS` | `6a83d9a5fb92ff7d4714edf41725dc37484439238a301912187a1fd97ed25f38` |
| `sbom.cyclonedx.json` | `b2febbdd9b182d05f2ece8ff4b1ac07b99eea00b3198f411918eb47c14f5e67b` |

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

npm metadata and clean-tarball CLI smoke, GitHub Release asset publication and
digests, Linux x64 standalone binary checksum/runtime, and anonymous GHCR
manifest and container runtime access for `v1.12.0`, `v1`, and `latest` are
verified as of 2026-07-13. All three image tags resolve to
`sha256:dd3dda38785c3a1c79bc9e848946d575dd397c3b1c16fef5ac09f1b674fe3b4e`.
Other standalone platform binaries were exercised by the release workflow but
were not independently downloaded in this audit. The external Homebrew tap was
not reverified and must not be inferred from the channel results above. The
`kicad-plugin/` directory was retired from main in commit `68e21df`.
