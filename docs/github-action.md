# GitHub Action Images

## Container Action

Use the full container action when CI must run KiCad checks without a separate
KiCad installation step. The container image includes KiCad CLI, Node.js, and
the published BoardReadyOps package.

The `ghcr.io/oaslananka/boardreadyops-full:v1` and `latest` images are
anonymously readable as of the 2026-08-07 verification. Pin the Action reference
to a release commit SHA for reproducibility.

```yaml
name: BoardReadyOps full

on:
  pull_request:

jobs:
  boardreadyops:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops/apps/container@884f5fa31f8fd701693c533747c69eb7d13f5464 # v1.30.1
        with:
          config: boardreadyops.yml
          require-kicad: "true"
          mode: enforce
```

`apps/container/action.yml` mirrors the Node action inputs and outputs. The
container action overrides the image CLI entrypoint so GitHub Actions receives
the same report files, outputs, SARIF upload behavior, and pull request comment
behavior as the root action.

The default image entrypoint remains the CLI for direct use:

```bash
docker run --rm ghcr.io/oaslananka/boardreadyops-full:v1 --help
```

The public `v1` and `latest` images were re-verified anonymously on
2026-08-07 with OCI index digest
`sha256:4df163600bd03126f072a5870db33f72db9991bf932fe275b5858e54f73fc650`.
The exact `v1.30.1`, `v1`, and `latest` tags all resolve to that same digest.

The image includes the unprivileged `boardreadyops` account at UID `10001` for
direct container runs that can provide writable mounts for that user. The
GitHub Docker action keeps the image default user so GitHub can mount and access
`GITHUB_WORKSPACE`.

Container image redistributes KiCad under GPL terms. The image preserves the
GPL text at `/usr/share/doc/boardreadyops/LICENSE-KICAD` and the KiCad package
notices under `/usr/share/doc/kicad/`; BoardReadyOps' Node code remains MIT
licensed and invokes KiCad as a separate CLI process.

Tagged container builds wait until the matching npm package version is visible,
then publish `linux/amd64` and `linux/arm64` images to GHCR. Stable release
tags update the matching major alias and `latest`; prerelease tags publish only
their exact tag. The release workflow signs the pushed digest with Cosign, scans
it with Trivy, emits a CycloneDX image SBOM artifact, and enables BuildKit
provenance and SBOM attestations.
