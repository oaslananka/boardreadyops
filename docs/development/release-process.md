# Release Process

BoardReadyOps releases are expected to be repeatable, documented, and auditable.

## Release channels

- npm package: `boardreadyops`.
- GitHub release: version tag plus binary assets, checksums, and SBOM.
- GitHub Action: pinned commit/tag usage through `action.yml` and committed dist.
- Container image: full runtime image with KiCad CLI when published.

## Release preparation

Before release, validate:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run verify:release
corepack pnpm run verify:release-channels
corepack pnpm run security
```

## Versioning

Use Semantic Versioning. Release-please owns version bumps and changelog updates.
Manual release changes must update `package.json`, `.release-please-manifest.json`,
`src/generated/version.ts`, and release documentation only through the supported
release flow.

## Artifacts

Release artifacts should include:

- npm package with provenance.
- GitHub release notes.
- Binary assets when supported.
- `SHA256SUMS`.
- SBOM.
- Artifact attestations when supported by the workflow.

## Post-release verification

Verify npm, GitHub release, tags, checksums, and documentation references after
publishing. Record gaps in `docs/release/channel-verification.md`.
