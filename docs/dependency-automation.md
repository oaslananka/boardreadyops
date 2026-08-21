# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for routine version-update pull requests.

## Execution

- `.github/workflows/renovate.yml` validates `renovate.json` on pull requests and changes to `main`. Validation runs the official Renovate image by immutable digest, with the repository mounted read-only and container networking disabled, so validation cannot drift through dynamically resolved `pnpm dlx` transitives.
- The pinned Renovate runner executes at 06:17 Europe/Istanbul on weekdays and can also be started manually.
- The runner is explicitly scoped to `oaslananka/boardreadyops`; repository autodiscovery and onboarding are disabled.
- The workflow uses the `GH_AUTH_TOKEN` repository secret. That credential must belong to a dedicated automation identity with the minimum repository permissions required to create branches, pull requests, labels, and issues.
- Post-upgrade command execution is restricted through `RENOVATE_ALLOWED_COMMANDS` to the exact `corepack pnpm run renovate:post-upgrade` entry point. That repository-controlled script creates an isolated temporary pnpm store for the dependency install, native rebuild, `NOTICE` refresh, and committed `dist/` rebuild, then removes the store. This prevents shared-runner pnpm store metadata from breaking `pnpm licenses list` while keeping Renovate unable to execute arbitrary post-upgrade commands.
- Renovate itself never runs on a pull-request event, so untrusted pull-request code cannot obtain the automation token.

## Policy

- Renovate owns npm workspace updates, GitHub Actions updates, Dockerfile updates, and Docker Compose updates.
- Generated output, dependency trees, and test fixtures are ignored.
- Dependency branches regenerate `NOTICE` and the committed `dist/` bundles through the allowlisted post-upgrade task, so license inventory and shipped CLI/Action bundle changes remain visible and reviewable in the pull request.
- GitHub repository security alerts and security update PRs remain enabled in repository security settings.
- Major upgrades require Dependency Dashboard approval and manual review.
- Core runtime and GitHub integration dependencies use exact manifest versions so unrelated lockfile refreshes cannot advance them implicitly; their updates, plus GitHub Actions, Dockerfile, and Docker Compose updates, require manual review.
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
- The repository reported `activated`, `enabled`, and `onboarded`, and Renovate discovered 269 dependencies across npm, GitHub Actions, Dockerfiles, and Docker Compose.
- After the workflow reached `main`, manual workflow run `29767533207` completed both `renovate / validate` and `renovate / run` successfully.
- The authenticated run created Dependency Dashboard issue `#196` and populated pending-approval, awaiting-schedule, status-check, abandoned-dependency, and detected-dependency sections.
- No update branches or pull requests were created outside the configured schedule or approval policy.

## Operations

1. Confirm the `renovate / validate` job passes after configuration changes.
2. Run the workflow manually after first installation or credential rotation.
3. Confirm that the `Dependency Dashboard` issue exists and that the workflow can create or update Renovate branches.
4. Rotate `GH_AUTH_TOKEN` immediately if its owner or permissions change unexpectedly.
