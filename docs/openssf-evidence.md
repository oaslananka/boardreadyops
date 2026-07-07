# OpenSSF Evidence

This file maps repository evidence to OpenSSF Best Practices and Scorecard-style
expectations. BadgeApp remains the source of truth for submitted answers; this
file is the maintainer-facing evidence register.

## Project identity

- Project: BoardReadyOps
- Repository: <https://github.com/oaslananka/boardreadyops>
- Package: `boardreadyops` on npm
- License: MIT
- OpenSSF Best Practices Badge project: <https://www.bestpractices.dev/projects/13378>

## Practices and evidence

| Practice area | Status | Repository evidence |
| --- | --- | --- |
| Public source repository | Passed | GitHub repository with README, docs, issues, PRs, and releases. |
| License declared | Passed | `LICENSE`, README badge, package metadata. |
| Contribution process | Passed | `CONTRIBUTING.md`, PR templates, issue templates. |
| Code of conduct | Passed | `CODE_OF_CONDUCT.md`. |
| Security reporting | Passed | `SECURITY.md`, `docs/security/disclosure.md`. |
| Supported versions | Passed | `docs/support-matrix.md`, README runtime support section. |
| CI tests | Passed | `.github/workflows/ci.yml`, `lint-fast.yml`, `self-smoke.yml`, `dist-check.yml`. |
| Static analysis | Passed | CodeQL through `security.yml`; Biome and TypeScript checks. |
| Dependency scanning | Passed | OSV/audit/dependency-review workflow coverage, Renovate policy, and GitHub security update settings. |
| Secret scanning in CI | Passed | Gitleaks workflow coverage. |
| Release process | Passed | release-please, publish-npm, provenance, release docs. |
| SBOM | Passed | `pnpm run sbom`, release SBOM asset. |
| Provenance/attestation | Passed | provenance and publish workflows plus docs. |
| Branch protection | Partial | `main` is protected by ruleset policy; applied repository state still needs periodic maintainer confirmation. |
| Human review | Partial | Approval and CODEOWNERS review are configured, but independent sustained review is not yet proven. |
| Multiple maintainers | Missing | Current maintainer model is single-maintainer. |
| Runtime plugin sandbox | Missing | Plugin permissions are declaration-level and do not yet enforce runtime isolation. |

## Local audit commands

Run these commands from the repository root before claiming refreshed evidence:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run coverage
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run security
corepack pnpm run docs
corepack pnpm run verify:release-channels
```

## Manual evidence to confirm

- Branch protection/rulesets require PRs and required status checks.
- Private vulnerability reporting is enabled.
- GitHub dependency alerts and security updates are enabled; Renovate handles version-update PRs.
- Secret scanning and push protection are enabled where the GitHub plan allows it.
- At least one independent human reviewer participates in sensitive PRs.
