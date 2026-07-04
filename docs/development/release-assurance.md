# Release assurance

BoardReadyOps releases must be repeatable, reviewable, and easy to audit.

## Branch controls

The `main` branch uses strict required checks, one required approving review, code owner review, stale review dismissal, conversation resolution, linear history, disabled force pushes, disabled deletion, and admin enforcement.

Required commit signatures are not enabled yet. That remains an explicit future hardening decision, not an assumed control.

## Release checks

Before publishing a release, maintainers must verify the build, committed distribution files, version metadata, marketplace metadata, package contents, project health checks, and generated release evidence.

The `dist-check` workflow includes the package content validator so the npm package contains release-critical files before release work continues.

## Artifact checks

Binary release preparation must build and verify each supported target, collect the artifacts, generate checksums, create SBOM evidence, and verify that generated checksums are current before release upload steps run.

Container release preparation must build the smoke image, run the CLI smoke checks, run the fixture project smoke check, and scan the image before any publish mode is used.

## Evidence expected for closure

The release hardening pass is healthy when these checks are green on `main`: CI, security workflow, dist-check, binary-build, and container-build smoke mode.
