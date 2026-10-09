# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for routine version-update pull requests.

## Execution and canonical owner

- **Mend-hosted Renovate GitHub App is the only dependency updater** for BoardReadyOps, matching the owner's other repositories. Its [Dependency Dashboard #978](https://github.com/oaslananka/boardreadyops/issues/978) is canonical. The former self-hosted dashboard [#196](https://github.com/oaslananka/boardreadyops/issues/196) is historical and may be closed **after this cutover is merged** and no older self-hosted workflow runs remain active.
- `.github/workflows/renovate.yml` now only validates `renovate.json` when relevant configuration changes; it has **no schedule, manual update dispatch, privileged runner or GH_AUTH_TOKEN access**. The pinned local validator image remains a reproducible, read-only config check.
- Mend's hosted Community plan cannot execute arbitrary repository `postUpgradeTasks`. `renovate.json` therefore does not request unsupported command execution. A two-job repository-owned `renovate-generated` workflow regenerates committed `NOTICE` and `dist` on Mend PRs without giving write credentials to the dependency build.
- The **first** workflow runs on PRs authored by `renovate[bot]` from a same-repo `renovate/` branch, using a read-only `GITHUB_TOKEN`, checkout without persisted credentials, a frozen install with scripts ignored, and the existing tested generation entry point. It publishes a one-day artifact containing only `NOTICE`, both CLI/Action bundles and a SHA-256 manifest bound to the PR head.
- The **second job** checks out the trusted base-branch generation verifier and runs no PR-controlled code: it checks a live open PR's bot identity, repository, `main` base, exact head SHA, and artifact hashes before copying **only three allowlisted output files**. A separate last step uses the preexisting `GH_AUTH_TOKEN` to push back to the original Renovate branch with an optimistic SHA lease. Using this existing credential for a branch update triggers the standard PR checks; no token enters the generation job. If the token is missing, access changes, or the branch advances, the step fails closed. Restrict its account permissions to BoardReadyOps branch/PR writes and rotate if compromised.
- Branch policy and Mergify still require required checks, resolved reviews, and an intentional maintainer enqueue. Failed generation or provenance validation must **not** be masked by CI skip/continue-on-error or by weakening `verify:dist`/NOTICE correctness checks.
- **Acceptance:** review that the Mend App retains access to BoardReadyOps, no self-hosted writer runs remain scheduled, and the old dashboard no longer updates. Prove at least one non-major hosted Renovate PR is updated by `renovate-generated-apply`, passes the regenerated artifact / notice checks on its *new head SHA*, and can be queued under existing protection. Do not auto-approve major updates or launch bulk dashboard PRs to manufacture a test.

## Policy layers

`renovate.json` is self-contained. It directly carries the conservative baseline that BoardReadyOps previously inherited from `github>oaslananka/.github:renovate-config`: the Europe/Istanbul timezone, seven-day routine release quarantine, strict internal age filtering, two new PRs per hour, five concurrent PRs, digest pinning, weekly lockfile maintenance, semantic commits, Dependency Dashboard, and explicit approval for major upgrades.

This repository-local baseline replaced an unavailable shared preset after the October 2, 2026 validation failure. It remains authoritative for Mend-hosted package policy without requiring cross-repository token access. The schedule, package managers, protected groups, vulnerability-PR policy and merge routing remain local. Generated files are refreshed by the isolated, repository-owned GitHub Actions flow described above. Generated output, dependency trees, and test fixtures remain excluded from discovery.

## Automatic path

Low-risk development dependency and `@types/*` non-major updates remain the routine path. Same-version GitHub Action digest refreshes are also routine when they do not touch security, release, provenance, publication, container-release, or binary-release workflows.

Routine classification never bypasses GitHub Rulesets. Required checks must pass and review conversations must be resolved before an explicit maintainer squash merge. The `automerge` label on low-risk dependency groups is classification metadata only; BoardReadyOps does not enable Renovate's own `automerge: true` path and Mergify does not queue or merge these pull requests.

## Exception path

Major updates, TypeScript, core runtime/GitHub integration dependencies, self-hosted Renovate runtime/validator upgrades, vulnerability-remediation PRs, non-digest GitHub Action updates, Actions changes in protected workflows, and Dockerfile/Docker Compose updates carry `manual-review` and remain on hold until a maintainer clears the exception.

GitHub Actions and container references remain digest-pinned. Security vulnerability remediation bypasses the routine schedule and release-age wait, requests the lowest known-safe version, and remains manual-review only.

## Pull-request creation

Routine minimum-age waiting is enforced by Renovate's strict internal checks before branch creation. BoardReadyOps CI and generated-file build begin on `pull_request`, not on bare Renovate branches; `prCreation: not-pending` could deadlock before those checks exist, so it remains disabled.

## Files

- `renovate.json` controls project-specific Renovate behavior.
- `.github/workflows/renovate.yml` validates the policy only; Mend hosts the sole dependency updater.
- `.github/workflows/renovate-generated.yml` generates allowlisted artifacts without write permissions.
- `scripts/renovate-generated-artifacts.mjs` is the fail-closed artifact and PR authorization contract.
- `.mergify.yml` provides pull-request classification plus a manual-only `main` merge queue; the GitHub `main` ruleset remains the merge authority.
- `tests/unit/scripts/security-automation-config.test.ts` prevents accidental weakening of the automation contract.
- Version-update PR configuration must not be duplicated in another dependency updater.

## Last verification

- On October 4, 2026, Mergify was configured as a manual-only queue: there is no auto-merge/auto-queue condition, and a maintainer must explicitly enqueue a PR with `@mergifyio queue main`. GitHub Rulesets remain authoritative for merge eligibility and required checks.
- On July 20, 2026, Renovate `43.272.4` completed a full dry-run under Node.js `24.18.0`.
- The repository reported `activated`, `enabled`, and `onboarded`, and Renovate discovered 269 dependencies across npm, GitHub Actions, Dockerfiles, and Docker Compose.
- After the workflow reached `main`, manual workflow run `29767533207` completed both `renovate / validate` and `renovate / run` successfully.
- The authenticated run created Dependency Dashboard issue `#196` and populated pending-approval, awaiting-schedule, status-check, abandoned-dependency, and detected-dependency sections.
- No update branches or pull requests were created outside the configured schedule or approval policy.
- On September 17, 2026, the shared `oaslananka/.github` preset was verified at commit `c44946c82eeb6c5041dbc94f371c55015679cbe0` (`renovate-config.json` blob `6ad5d7c7232908a686a4b9e0404fb30f4d30c2da`).
- On October 2, 2026, scheduled run `36992286708` failed before repository processing because that shared preset could no longer be resolved. BoardReadyOps therefore activated the documented repository-local recovery path instead of widening `GH_AUTH_TOKEN` access to another repository.
- BoardReadyOps implementation PR `#819` merged through Mergify's `default` queue after the `main` Ruleset conditions, including `ci / risk-profile` and `security / gate`, were satisfied.
- Post-merge manual Renovate workflow run `35251461740` ran against merge commit `6e5a7b020a335a19b57ec251969d4dd8f84efa20`; both `renovate / validate` and `renovate / run` completed successfully.
- Dependency Dashboard `#196` updated at `2026-09-17T17:16:35Z`. No Renovate or Dependabot PR remained open after the run; routine developer-tooling, type-definition, and lockfile updates were awaiting their schedule while major updates remained pending approval.
- No representative low-risk dependency PR auto-entered Mergify during this verification because the run created no PR outside the configured schedule. The next naturally eligible low-risk Renovate PR remains the live queue/merge acceptance sample.

## Operations

1. Confirm the repository-local conservative baseline remains present in `renovate.json`; do not reintroduce an external preset dependency without a separately verified availability and credential contract.
2. Run `corepack pnpm run renovate:validate` after policy changes.
3. Confirm `security-automation-config.test.ts` and `mergify-integration.test.ts` pass.
4. Confirm `manual-review` is present on protected updates and absent from an eligible low-risk update.
5. Confirm the PR receives the repository's required Ruleset checks and that review conversations are resolved.
6. After the PR is intentionally approved for merge, enqueue it with `@mergifyio queue main` (or the Mergify queue control). Do not enable Mergify auto-merge/auto-queue; an open green PR should remain open until a maintainer explicitly queues it.
7. Confirm Mend-hosted Renovate updates canonical dashboard #978; the repository workflow is validation-only and must never run a second Renovate writer.
8. Rotate `GH_AUTH_TOKEN` immediately if its owner or permissions change unexpectedly and verify restricted regenerated-file branch updates still work.
