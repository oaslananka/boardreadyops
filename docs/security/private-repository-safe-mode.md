# Private repository and fork PR safe mode

Issue: #42

## Goal

BoardReadyOps must not run privileged readiness workflows on private repositories, fork pull requests, or draft pull requests unless an explicit safer execution mode is available.

## Default policy

The GitHub App still records the release run and creates a check run, but runner dispatch is skipped when any of these conditions is true:

- the repository is private,
- the pull request comes from a fork,
- the pull request is a draft.

The check run is completed as neutral with a safe-mode explanation instead of remaining queued.

## Why this is the default

- Private repositories may contain customer or proprietary hardware data.
- Fork pull requests may originate from untrusted code and should not receive privileged runner access.
- Draft pull requests are not ready for release-readiness execution.

## Captured metadata

For pull request events, the lifecycle normalizer records:

- whether the repository is private,
- whether the PR head repository differs from the base repository,
- whether the PR is draft,
- the PR head repository full name when present.

## Future expansion

A later self-hosted runner mode can allow private repositories when all of these are true:

- the installation owner explicitly enables private repository execution,
- the runner is tenant-scoped,
- artifact storage is tenant-scoped,
- fork PRs remain restricted unless reviewed and approved,
- audit logs record the safe-mode override.

## Acceptance criteria

- Fork PRs do not dispatch the readiness runner by default.
- Private repositories do not dispatch the readiness runner by default.
- Draft PRs do not dispatch the readiness runner by default.
- Skipped checks complete as neutral with an actionable explanation.
- Normal public same-repository PRs continue to dispatch as before.
