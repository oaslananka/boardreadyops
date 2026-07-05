# Release assurance

BoardReadyOps releases must be repeatable, reviewable, and easy to audit.

## Branch controls

The `main` branch uses strict required checks, one required approving review, code owner review, stale review dismissal, conversation resolution, linear history, disabled force pushes, disabled deletion, and admin enforcement.

Required commit signatures are not enabled yet. That remains an explicit future hardening decision, not an assumed control.

### Required status checks

The following CI jobs are expected as required status checks on `main`. Maintainers should confirm these match the current `ci.yml` job names when updating branch protection:

- `ci / lint`
- `ci / typecheck`
- `ci / test-unit`
- `ci / test-int (KiCad 10.0, Node 22)`
- `ci / test-int (KiCad 10.0, Node 24)`
- `ci / build`
- `ci / verify-dist`
- `ci / coverage-gate`
- `lint-fast`

Jobs that are conditionally skipped (e.g. `ci / mutation`, `ci / test-action`) are not required by default. Update this list when workflow jobs are added, renamed, or removed.

## Release checks

Before publishing a release, maintainers must verify the build, committed distribution files, version metadata, marketplace metadata, package contents, project health checks, and generated release evidence.

The `dist-check` workflow includes the package content validator so the npm package contains release-critical files before release work continues.

## Artifact checks

Binary release preparation must build and verify each supported target, collect the artifacts, generate checksums, create SBOM evidence, and verify that generated checksums are current before release upload steps run.

Container release preparation must build the smoke image, run the CLI smoke checks, run the fixture project smoke check, and scan the image before any publish mode is used.

## npm package provenance

`package.json` sets `publishConfig.provenance: true`. When the `publish-npm` workflow runs with `id-token: write` permission, npm generates and attaches a Sigstore-based provenance attestation to every published package version. This links the package to the exact GitHub Actions workflow run that produced it.

The `publish-npm` workflow also uses `actions/attest-build-provenance` to create a GitHub Artifact Attestation for the committed `dist/**` bundles. This provides an additional, independently verifiable chain from the source commit to the published distribution files.

Container images follow the same practice: the `container-build` workflow builds and attests the image before publishing to GHCR.

## Maintainer release checklist

Before creating or publishing a release, the maintainer must verify:

1. All required CI checks are green on `main`.
2. `corepack pnpm run verify` passes locally (or on a clean runner).
3. `npm pack --dry-run --json` confirms the tarball includes `dist/cli/index.cjs`, `dist/action/index.cjs`, `package.json`, `README.md`, `LICENSE`, `NOTICE`, `SECURITY.md`, and `action.yml`.
4. The release-please PR version, `CHANGELOG.md`, `package.json`, `.release-please-manifest.json`, and `src/generated/version.ts` are consistent.
5. Binary assets, `SHA256SUMS`, and `sbom.cyclonedx.json` are uploaded to the GitHub Release.
6. `Formula/boardreadyops.rb` checksums are updated for the new release binaries.
7. GHCR `v1`, `v1.MAJOR`, and `latest` floating tags resolve to the correct digest after the container workflow completes.

## Failure recovery

### npm publish failed

1. Check the `publish-npm` workflow run logs for the exact error.
2. If the package was partially published (unlikely with npm's atomic publish), verify with `npm view boardreadyops@<version>` and check the `dist-tags`.
3. If auth failed: rotate `NPM_TOKEN` in the repository secrets and re-run the workflow via `workflow_dispatch`.
4. If provenance signing failed: confirm the workflow has `id-token: write` and that the npm package on npmjs.org allows trusted publishing from the repository.
5. If the package version already exists: the workflow will skip publication without error (idempotent check is built in).

### Release tag on wrong commit

1. Do not force-push or delete the tag on `main`. Create a new patch release instead.
2. If a prerelease tag needs correction before the release is published, delete the tag locally and remotely (`git tag -d vX.Y.Z && git push origin :vX.Y.Z`) and re-tag the correct commit.

### CI broke on main after a merge

1. Do not publish a release until `main` is green.
2. Open a fix PR with the `fix:` scope, get review, and merge via the standard process.
3. If the breakage is in a required status check, the automated release-please PR will not be mergeable until the check passes.

### Signed artifact attestation missing

1. Verify the `publish-npm` and `provenance` workflow runs completed successfully.
2. Run `gh attestation verify dist/cli/index.cjs --repo oaslananka/boardreadyops` to confirm the attestation is queryable.
3. If missing, re-run the `provenance` workflow via `workflow_dispatch` against the release tag.

## Evidence expected for closure

The release hardening pass is healthy when these checks are green on `main`: CI, security workflow, dist-check, binary-build, and container-build smoke mode.
