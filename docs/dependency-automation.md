# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for routine version-update pull requests.

## Execution

- `.github/workflows/renovate.yml` validates `renovate.json` on pull requests and changes to `main`. Validation runs the official Renovate image by immutable digest, with the repository mounted read-only and container networking disabled, so validation cannot drift through dynamically resolved `pnpm dlx` transitives.
- The pinned Renovate runner executes at 06:17 Europe/Istanbul on weekdays and can also be started manually.
- The runner is explicitly scoped to `oaslananka/boardreadyops`; repository autodiscovery and onboarding are disabled.
- The workflow uses the `GH_AUTH_TOKEN` repository secret. That credential must belong to a dedicated automation identity with the minimum repository permissions required to create branches, pull requests, labels, and issues.
- Post-upgrade command execution is restricted through `RENOVATE_ALLOWED_COMMANDS` to the exact `corepack pnpm run renovate:post-upgrade` entry point. That repository-controlled script creates an isolated temporary pnpm store for the dependency install, native rebuild, `NOTICE` refresh, and committed `dist/` rebuild, then removes the store. This prevents shared-runner pnpm store metadata from breaking `pnpm licenses list` while keeping Renovate unable to execute arbitrary post-upgrade commands.
- Renovate itself never runs on a pull-request event, so untrusted pull-request code cannot obtain the automation token.

## Policy layers

`renovate.json` extends `github>oaslananka/.github:renovate-config`. The shared preset owns the seven-day routine release quarantine, strict internal age filtering, two new PRs per hour, five concurrent PRs, digest pinning, weekly lockfile maintenance defaults, and Dependency Dashboard approval for major upgrades.

BoardReadyOps owns its weekday schedule, managed package managers, generated `NOTICE`/`dist/` refresh, protected package groups, vulnerability-PR policy, and merge routing. Generated output, dependency trees, and test fixtures remain excluded from discovery.

## Automatic path

Low-risk development dependency and `@types/*` non-major updates remain eligible for the normal Mergify queue. Same-version GitHub Action digest refreshes are also eligible when they do not touch security, release, provenance, publication, container-release, or binary-release workflows.

Eligibility never bypasses GitHub Rulesets. Required checks must pass before queue admission and again before merge. The `automerge` label on low-risk dependency groups is classification metadata; BoardReadyOps does not enable Renovate's own `automerge: true` path.

## Exception path

Major updates, TypeScript, core runtime/GitHub integration dependencies, vulnerability-remediation PRs, non-digest GitHub Action updates, Actions changes in protected workflows, and Dockerfile/Docker Compose updates carry `manual-review` and remain outside the automatic queue until a maintainer clears the exception.

GitHub Actions and container references remain digest-pinned. Security vulnerability remediation bypasses the routine schedule and release-age wait, requests the lowest known-safe version, and remains manual-review only.

## Pull-request creation

Routine minimum-age waiting is enforced by Renovate's strict internal checks before branch creation. BoardReadyOps CI begins on `pull_request`, not on bare Renovate branches, so the repository does not use `prCreation: not-pending`; otherwise a dependency branch can wait for checks that cannot start until the pull request exists.

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

1. Confirm the shared preset resolves successfully.
2. Run `corepack pnpm run renovate:validate` after policy changes.
3. Confirm `security-automation-config.test.ts` and `mergify-integration.test.ts` pass.
4. Confirm `manual-review` is present on protected updates and absent from an eligible low-risk update.
5. Confirm the PR receives the repository's required Ruleset checks before Mergify admits it.
6. Treat any low-risk PR that stays open after green required checks as an automation defect.
7. Run the Renovate workflow manually after first installation or credential rotation and confirm the Dependency Dashboard can be updated.
8. Rotate `GH_AUTH_TOKEN` immediately if its owner or permissions change unexpectedly.
