# GitHub Action Images

## Container Action

Use the full container action when CI must run KiCad checks without a separate
KiCad installation step. The container image includes KiCad CLI, Node.js, and
the published BoardReadyOps package.

Pin the Action reference to a reviewed release commit SHA to fix its metadata.
The container Action uses a moving GHCR image alias; a pinned Action reference
does not by itself freeze the image bytes. For direct container runs requiring
an immutable image, use the verified version and digest shown below.

```yaml
name: BoardReadyOps full

on:
  pull_request:

jobs:
  boardreadyops:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops/apps/container@6b41a224869f9a0ae646566663a914a89402fb47 # v1.72.0
        with:
          config: boardreadyops.yml
          require-kicad: "true"
          mode: enforce
```

`apps/container/action.yml` mirrors the Node action inputs and outputs. The
container action overrides the image CLI entrypoint so GitHub Actions receives
the same report files, outputs, SARIF upload behavior, and pull request comment
behavior as the root action.


## Pull request hardware impact

The Node and container actions share the same exact-base hardware-impact behavior. On a pull request, `comment-format: review` compares the exact PR base SHA with the exact analyzed head SHA when the same workflow has a valid BoardReadyOps JSON artifact for that base commit. `actions: read` lets the short-lived repository `GITHUB_TOKEN` discover that historical workflow artifact. Missing exact-base evidence is reported explicitly; BoardReadyOps never silently substitutes another run and does not change the current-run decision because the comparison is unavailable.

The source checkout and full previous/current report artifacts stay in the target repository. Hosted execution may publish only the bounded structured hardware-impact summary and evidence references described in the JSON report contract.

The default image entrypoint remains the CLI for direct use:

```bash
docker run --rm ghcr.io/oaslananka/boardreadyops-full:v1 --help
```

On 2026-11-27, the public GHCR `v1.72.0`, `v1`, and `latest` image tags
resolved to OCI index digest
`sha256:92e5be92e7883a1c250c08adb9782c3441aeb8a99a77e6a64f5b6c7d811cc058`
with Linux amd64 and arm64 manifests. This is dated registry metadata evidence,
not a fresh runtime smoke test. The moving image aliases may change; verify
them again before use. An exact digest pins the selected image bytes:

```bash
docker run --rm ghcr.io/oaslananka/boardreadyops-full:v1.72.0@sha256:92e5be92e7883a1c250c08adb9782c3441aeb8a99a77e6a64f5b6c7d811cc058 --help
```

The image includes the unprivileged `boardreadyops` account at UID `10001` for
direct container runs that can provide writable mounts for that user. The
GitHub Docker action keeps the image default user so GitHub can mount and access
`GITHUB_WORKSPACE`.

Container image redistributes KiCad under GPL terms. The image preserves the
GPL text at `/usr/share/doc/boardreadyops/LICENSE-KICAD` and the KiCad package
notices under `/usr/share/doc/kicad/`; BoardReadyOps project-authored Node code is licensed under GNU AGPL v3.0
licensed and invokes KiCad as a separate CLI process.

Tagged container builds wait until the matching npm package version is visible,
then publish `linux/amd64` and `linux/arm64` images to GHCR. Stable release
tags update the matching major alias and `latest`; prerelease tags publish only
their exact tag. The release workflow signs the pushed digest with Cosign, scans
it with Trivy, emits a CycloneDX image SBOM artifact, and enables BuildKit
provenance and SBOM attestations.
