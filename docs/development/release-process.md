# Release Process

BoardReadyOps releases are expected to be repeatable, documented, and auditable.

## Release channels

- npm package: `boardreadyops`.
- GitHub release: version tag plus binary assets, checksums, and SBOM.
- GitHub Action: pinned commit/tag usage through `action.yml` and committed dist.
- Container image: full runtime image with KiCad CLI when published.

## Release preparation and publication

The `release-please` workflow is a daily preparation-only job (06:37 Europe/Istanbul)
and can also be run manually to refresh the version PR. It cannot publish a GitHub
Release or tag. Review the release PR, wait for successful required and supplemental
checks, and intentionally merge it before manually running the input-free
**Actions → Publish Release → Run workflow (main)**. This owner-only workflow
creates the immutable tag and release, then dispatches existing `publish-npm`
Trusted Publishing. No `main` push, schedule, or release PR merge launches
publication automatically. A held release PR must not be merged or published.

## Pre-release validation

Before creating or publishing a release, validate the same gates used by release automation:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
corepack pnpm run verify:release-channels
corepack pnpm run verify:clean-tree
npm pack --dry-run --json
```

The release package dry run must confirm that the npm tarball includes `package.json`, `README.md`,
`LICENSE`, `NOTICE`, `SECURITY.md`, `action.yml`, `dist/cli/index.cjs`, and `dist/action/index.cjs`.

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
