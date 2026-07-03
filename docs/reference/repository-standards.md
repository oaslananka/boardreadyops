# Repository Standards Reference

This reference summarizes the expected repository standards for BoardReadyOps.

## Classification vocabulary

Every maturity criterion should be classified as one of:

- `Passed`
- `Partial`
- `Missing`
- `Not applicable`
- `Needs human confirmation`

## Required public files

- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `SUPPORT.md`
- `GOVERNANCE.md`
- `MAINTAINERS.md`
- `.github/CODEOWNERS`
- GitHub issue and pull request templates

## Required validation command families

- Install using the pinned package manager.
- Lint and format checks.
- Type checking.
- Unit, integration, property, snapshot, and Action tests.
- Coverage checks.
- Build and distribution verification.
- License, NOTICE, REUSE, dependency, and security checks.
- Documentation generation.

## Review-sensitive surfaces

The following surfaces require maintainer review even when automated checks pass:

- `.github/workflows/**`
- Release and publish scripts.
- `src/core/plugin-loader.ts` and process/filesystem/network code.
- `schemas/**` and public report formats.
- `action.yml` and GitHub Action input handling.
- Governance, maintainer, security, support, and disclosure docs.
