# Dependency Automation

BoardReadyOps uses Renovate as the single source of truth for routine version-update pull requests.

## Ownership

- Renovate owns npm workspace, pnpm package-manager, GitHub Actions, Dockerfile, and Docker Compose updates.
- GitHub repository vulnerability alerts and security update pull requests remain enabled as emergency controls.
- `.github/dependabot.yml` must remain absent so routine version updates are not duplicated.
- `renovate.json` controls update policy; `.mergify.yml` controls post-CI automerge.

## Schedule and stability

Routine non-security updates are created on Monday between 02:00 and 06:00 in `Europe/Istanbul`. Normal releases must be at least three days old. TypeScript, pnpm, Next.js, React, Prisma, and PostgreSQL tooling use a seven-day minimum release age.

Vulnerability alerts are allowed at any time. Lockfile maintenance runs before 06:00 on Monday. Renovate is limited to three new pull requests per hour and six concurrent pull requests to protect CI capacity.

## Review policy

- Major updates require Dependency Dashboard approval and manual review.
- Dependencies currently below `1.0.0` are treated as potentially breaking and require manual review.
- TypeScript, pnpm, Next.js, React, Prisma, PostgreSQL, GitHub Actions, Dockerfile, and Docker Compose changes require manual review.
- GitHub Actions and container references remain digest-pinned.
- Low-risk development dependency and `@types/*` minor/patch updates may receive the `automerge` label. Renovate never merges directly; Mergify may squash-merge only after required checks pass.

## Required labels

| Label | Purpose |
| --- | --- |
| `dependencies` | All dependency update pull requests |
| `automerge` | Low-risk update eligible for post-CI automatic merge |
| `manual-review` | Explicit maintainer review required |
| `breaking-change` | Major or potentially breaking update |
| `supply-chain` | Actions, containers, provenance, or dependency supply-chain surface |
| `types` | TypeScript declarations and type tooling |
| `lockfile-maintenance` | Scheduled lockfile-only maintenance |
| `security` | Vulnerability-driven update |

## Validation

Validate the committed configuration under Node.js 24.11 or newer:

```bash
pnpm renovate:validate
```

The repository policy test also verifies critical manager, scheduling, grouping, and review boundaries.

## Operational verification

As of July 20, 2026, the Renovate GitHub App appears in repository check suites, but no Dependency Dashboard, Renovate pull request, or `renovate/*` branch was found. After this configuration is merged, a repository owner must verify onboarding in **GitHub → Settings → GitHub Apps → Renovate → Configure**, confirm this repository is selected, and request a rescan/onboarding run when the App UI offers it.

Successful onboarding is proven by a `Dependency Dashboard` issue or Renovate pull request. Record the result and date in this section after verification. No personal access token should be committed or used by repository scripts.
