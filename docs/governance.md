# Governance

This page summarizes the repository governance policy for contributors and
agents. The root
[GOVERNANCE.md](https://github.com/oaslananka/boardreadyops/blob/main/GOVERNANCE.md)
is the maintainer-facing policy file.

## Source Of Truth

- GitHub Issues and GitHub Pull Requests are the public source of truth for contribution intake, discussion, review state, and CI evidence.
- The root `GOVERNANCE.md` owns maintainer policy and repository protection expectations.
- ADRs under `docs/architecture/adr/` own architectural decisions.
- Release-please owns release pull request generation; code agents must not merge release-please pull requests unless the maintainer explicitly changes scope.

Maintainers may associate optional private tracker metadata through internal automation. That metadata does not replace the public GitHub contribution record and is never required from an external contributor.

## Pull Request Requirements

Every pull request must:

- Keep one coherent change in scope.
- Use a descriptive topic branch in the repository or contributor fork; no private tracker prefix is required.
- Fill in `.github/pull_request_template.md`.
- Link the related GitHub issue when one exists, or explain why a direct pull request is sufficient.
- List validation commands and results.
- Keep generated docs, bundles, notices, and schemas in sync with source changes.
- Pass required CI before merge.

Security vulnerabilities and sensitive security details are not part of public issue intake. Report them through the private process in `SECURITY.md`.

## Review And Ownership

Every pull request targeting `main` must pass the required checks. While
`@oaslananka` is the sole maintainer, the ruleset uses zero required human
approvals. Unresolved review conversations still block merge, and the maintainer
must inspect automated analysis, security findings, coverage, and CI evidence
before merging.

`CODEOWNERS` continues to identify responsible ownership. CODEOWNERS review is
not required while `@oaslananka` is both the sole code owner and sole maintainer,
because that setting would not provide an independent reviewer. Re-evaluate both
CODEOWNERS review and a one-approval rule when another trusted maintainer or
dedicated security owner is onboarded.

Release Please, Renovate, Dependabot, GitHub Actions, and other automation have
no silent merge path. They may create or update pull requests, which must pass
the same checks, resolve review conversations, and receive an explicit maintainer
merge decision.

## Branch Protection Baseline

`main` is protected by `.github/rulesets/main.json`, which is the repository
source of truth. The active baseline requires:

- zero required human approvals while the repository remains single-maintainer;
- stale approvals dismissed after reviewable pushes;
- all review conversations resolved;
- strict required status checks and an up-to-date branch;
- squash-only merges and linear history;
- no force pushes or branch deletion; and
- a PR-only emergency bypass for the repository administrator role; and
- an exempt Mergify GitHub App bypass used only to operate the configured merge queue.

The stable required checks are:

| Context | Purpose |
| --- | --- |
| `ci / risk-profile` | Route change-sensitive validation |
| `ci / lint` | Code style, workflow, and policy validation |
| `ci / typecheck` | TypeScript type safety |
| `ci / test-unit` | Deterministic unit regression suite |
| `ci / build` | Bundle and artifact compilation |
| `ci / verify-dist` | Committed bundle integrity |
| `ci / coverage-gate` | Core and cloud coverage enforcement |
| `security / gate` | Aggregate mandatory security, dependency, secret, compliance, and SBOM decision |

Conditional matrix, integration, accessibility, coverage, mutation, and
specialist security-scanner jobs continue to run according to the risk profile
or their own workflow triggers. `security / gate` reports applicable and
non-applicable security checks explicitly; the underlying scanner names are not
branch-protection contracts.

## Emergency Bypass

The human emergency bypass is the repository administrator role with
`bypass_mode: pull_request`. This PR-only emergency bypass preserves the pull
request and audit trail and cannot be used for a direct push. The Mergify GitHub
App is separately configured with `bypass_mode: exempt` solely for merge-queue
operation. Mergify must continue to use `branch_protection_injection_mode: queue`
so the GitHub ruleset requirements are enforced by the queue before admission and
again before merge.

Use it only when a ruleset or CI infrastructure failure blocks a material
security, release, or availability fix. Before merge:

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
