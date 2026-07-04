# How to Configure CI Quality Gates

BoardReadyOps uses layered quality gates so contributors can run focused checks
locally and maintainers can require stable checks in GitHub.

## Recommended local gate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run build
corepack pnpm run verify:dist
```

## Recommended branch protection checks

After confirming exact check names in the repository UI, require the stable checks
that cover the changed surface. At minimum:

- CI / unit and integration test job.
- Lint/typecheck job.
- Dist verification job.
- Security workflow for protected release branches.

Do not require flaky scheduled jobs until they are stable. As of the 2026-07-02
maturity audit, `mutation-nightly` should not be a required merge check until the
type-only file false failure is fixed.

## Pull request policy

- Require at least one approval.
- Require CODEOWNERS review for repository policy, workflows, release, source,
  schemas, and documentation surfaces.
- Require the branch to be up to date before merging.
- Dismiss stale approvals after new commits when there are enough reviewers to
  sustain the policy.

## Escalation policy

Treat the following changes as sensitive and require explicit maintainer review:

- Release and publish workflows.
- Token permissions and GitHub Actions workflow changes.
- Public JSON schemas and report contracts.
- Plugin loading, process execution, filesystem, network, or notifier behavior.
- Security disclosure and vulnerability handling docs.
