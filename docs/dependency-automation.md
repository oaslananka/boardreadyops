# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for version-update pull requests.

## Policy

- Renovate owns npm workspace updates, GitHub Actions updates, Dockerfile updates, and Docker Compose updates.
- GitHub repository security alerts and security update PRs remain enabled in repository security settings.
- Major upgrades require Dependency Dashboard approval and manual review.
- GitHub Actions, Dockerfile, and Docker Compose updates are reviewed manually because they affect the supply-chain surface.
- Low-risk development dependency and `@types/*` minor/patch updates receive the `automerge` label and may be squash-merged by Mergify after required checks pass.

## Files

- `renovate.json` controls Renovate behavior.
- `.mergify.yml` controls post-CI automerge behavior.
- Version-update PR configuration should not be duplicated in another dependency updater.
