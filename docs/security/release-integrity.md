# Release Integrity

Release integrity protects users who install BoardReadyOps through npm, GitHub
release binaries, the GitHub Action, or container images.

## Integrity controls

| Control | Status | Evidence |
| --- | --- | --- |
| Semantic versioning | Passed | release-please and version verification scripts. |
| npm provenance | Passed | Publish workflow verifies package version and provenance configuration. |
| npm publish authentication | Trusted Publishing | GitHub-hosted `publish-npm.yml` uses OIDC and fails closed if token/basic npm authentication is injected. |
| GitHub release assets | Passed | Latest release includes platform assets, `SHA256SUMS`, and SBOM. |
| Checksums | Passed | Install scripts download and verify `SHA256SUMS`. |
| SBOM | Passed | `pnpm run sbom` and release SBOM artifact. |
| Artifact attestations | Passed | Provenance/attestation workflow coverage. |
| Signed evidence bundles | Passed | CLI supports signing and verification for release manifests. |
| Reproducible binary builds | Partial | Build and bundle verification exist; independent reproducibility evidence is a future improvement. |

## Consumer verification

Users should prefer pinned versions and verify binary assets through checksums.

```bash
curl -fsSLO https://github.com/oaslananka/boardreadyops/releases/download/v1.36.0/SHA256SUMS
sha256sum -c SHA256SUMS
```

For npm usage, pin a version in CI instead of using an unbounded global install
for release-critical workflows.

## Maintainer release checklist

1. Verify release-please PR contents and changelog.
2. Run release verification commands from `docs/development/release-process.md`.
3. Confirm generated bundles and package metadata match the release version.
4. Confirm GitHub release assets, `SHA256SUMS`, and SBOM are present.
5. Confirm npm package provenance and version metadata, including the GitHub repository, workflow, commit, and run associated with the Trusted Publishing attestation.
6. Confirm the publish run did not use a long-lived npm token or write registry authentication to `.npmrc`.
7. Confirm release docs and README examples reference the current tag/commit.
8. Record any channel drift in `docs/release/channel-verification.md`.

## Not accepted

- Publishing from a dirty working tree.
- Publishing without passing release verification.
- Manually editing generated dist bundles.
- Storing signing keys in repository files.
- Silently replacing release assets with different checksums.
