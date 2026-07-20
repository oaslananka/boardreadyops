# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for routine version-update pull requests.

## Execution

- `.github/workflows/renovate.yml` validates `renovate.json` on pull requests and changes to `main`.
- The pinned Renovate runner executes at 06:17 Europe/Istanbul on weekdays and can also be started manually.
- The runner is explicitly scoped to `oaslananka/boardreadyops`; repository autodiscovery and onboarding are disabled.
- The workflow uses the `GH_AUTH_TOKEN` repository secret. That credential must belong to a dedicated automation identity with the minimum repository permissions required to create branches, pull requests, labels, and issues.
- Renovate itself never runs on a pull-request event, so untrusted pull-request code cannot obtain the automation token.

## Policy

- Renovate owns npm workspace updates, GitHub Actions updates, Dockerfile updates, and Docker Compose updates.
- Generated output, dependency trees, and test fixtures are ignored.
- GitHub repository security alerts and security update PRs remain enabled in repository security settings.
- Major upgrades require Dependency Dashboard approval and manual review.
- Core runtime, GitHub integration, GitHub Actions, Dockerfile, and Docker Compose updates require manual review.
- Low-risk development dependency and `@types/*` minor/patch updates wait at least seven days, receive the `automerge` label, and may be squash-merged by Mergify after all required checks pass.
- TypeScript compiler updates wait at least seven days and always require manual review.
- GitHub Actions and container references remain digest-pinned.

## Files

- `renovate.json` controls project-specific Renovate behavior.
- `.github/workflows/renovate.yml` validates and runs the pinned self-hosted Renovate release.
- `.mergify.yml` is the post-CI merge authority.
- `tests/unit/scripts/security-automation-config.test.ts` prevents accidental weakening of the automation contract.
- Version-update PR configuration must not be duplicated in another dependency updater.

## Last verification

- On July 20, 2026, Renovate `43.272.4` completed a full dry-run under Node.js `24.18.0`.
- The repository reported `activated`, `enabled`, and `onboarded`.
- Renovate discovered 269 dependencies across npm, GitHub Actions, Dockerfiles, and Docker Compose.
- The dry-run confirmed that Renovate would create or update the `Dependency Dashboard` without writing repository state.
- The first non-dry scheduled/manual workflow run must be observed after this workflow reaches `main`.

## Operations

1. Confirm the `renovate / validate` job passes after configuration changes.
2. Run the workflow manually after first installation or credential rotation.
3. Confirm that the `Dependency Dashboard` issue exists and that the workflow can create or update Renovate branches.
4. Rotate `GH_AUTH_TOKEN` immediately if its owner or permissions change unexpectedly.
