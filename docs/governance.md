# Governance

This page summarizes the repository governance policy for contributors and
agents. The root
[GOVERNANCE.md](https://github.com/oaslananka/boardreadyops/blob/main/GOVERNANCE.md)
is the maintainer-facing policy file.

## Source Of Truth

- Linear team `BOARD` owns roadmap priority and task state.
- GitHub owns branches, pull requests, code review metadata, and CI evidence.
- ADRs under `docs/architecture/adr/` own architectural decisions.
- Release-please owns release pull request generation; code agents must not merge
  release-please pull requests unless the maintainer explicitly changes scope.

## Pull Request Requirements

Every pull request must:

- Address exactly one Linear issue.
- Use a branch named `codex/BOARD-<id>-<short-slug>` for Codex agent work.
- Fill in `.github/pull_request_template.md`.
- Link the Linear issue.
- List validation commands and results.
- Keep generated docs, bundles, notices, and schemas in sync with source changes.
- Pass required CI before merge.

## Review And Ownership

Every pull request targeting `main` requires one independent approving review
from a reviewer with write access. A review is no longer valid after a
reviewable commit changes, and unresolved review conversations block merge.
Automated analysis is evidence for the reviewer, not a replacement for approval.

`CODEOWNERS` continues to identify responsible ownership. CODEOWNERS review is
not required while `@oaslananka` is both the sole code owner and sole maintainer,
because that setting would not provide an independent reviewer. Re-evaluate it
when another maintainer or dedicated security owner is onboarded.

Release Please, Renovate, Dependabot, GitHub Actions, and other automation have
no silent review bypass. They may create or update pull requests, which then
follow the same review policy.

## Branch Protection Baseline

`main` is protected by `.github/rulesets/main.json`, which is the repository
source of truth. The active baseline requires:

- signed commits with a GitHub-verified signature;
- one independent approving review;
- stale approvals dismissed after reviewable pushes;
- all review conversations resolved;
- strict required status checks and an up-to-date branch;
- squash-only merges and linear history;
- no force pushes or branch deletion; and
- a PR-only emergency bypass for the repository administrator role.

The stable required checks are:

| Context | Purpose |
| --- | --- |
| `ci / risk-profile` | Route change-sensitive validation |
| `ci / lint` | Code style, workflow, and policy validation |
| `ci / typecheck` | TypeScript type safety |
| `ci / test-unit` | Deterministic unit regression suite |
| `ci / build` | Bundle and artifact compilation |
| `ci / verify-dist` | Committed bundle integrity |
| `security / gate` | Aggregate mandatory security, dependency, secret, compliance, and SBOM decision |

Conditional matrix, integration, accessibility, coverage, mutation, and
specialist security-scanner jobs continue to run according to the risk profile
or their own workflow triggers. `security / gate` reports applicable and
non-applicable security checks explicitly; the underlying scanner names are not
branch-protection contracts.

## Emergency Bypass

The only bypass actor is the repository administrator role with
`bypass_mode: pull_request`. This PR-only emergency bypass preserves the pull
request and audit trail and cannot be used for a direct push.

Use it only when no eligible reviewer is available and delay creates a material
security, release, or availability risk. Before merge:

1. all required checks must be green;
2. the pull request must carry `manual-review`;
3. the maintainer must comment with the reason, scope, and rollback plan; and
4. automation findings and review conversations must be resolved.

A retrospective review is required within two business days. Findings must be
captured as follow-up issues and linked from the bypassed pull request.

## Applying And Verifying Protection

Apply the committed ruleset and squash-only repository merge settings with:

```bash
scripts/setup-branch-protection.sh oaslananka/boardreadyops main
```

The helper creates or updates the repository ruleset through the GitHub API. It
does not apply legacy classic branch protection.

Verify the active ruleset with:

```bash
gh api repos/oaslananka/boardreadyops/rulesets
gh api repos/oaslananka/boardreadyops/rulesets/<id>
```

Compare approval count, stale-review handling, thread resolution, bypass actors,
merge methods, and required status contexts against `.github/rulesets/main.json`.
External settings changes must be represented in the committed ruleset and this
document in the same pull request.
