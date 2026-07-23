# Governance

BoardReadyOps is currently maintained as a single-maintainer project. This file
defines how changes land, how decisions are recorded, and what repository
protections are expected before stable releases.

## Decision Making

- Linear team `BOARD` is the planning source of truth for roadmap and task
  priority.
- GitHub is used for code, branches, pull requests, and CI results.
- Architectural decisions are recorded as ADRs under `docs/architecture/adr/`.
- Public contract changes must update the matching docs, schemas, examples, and
  validation commands in the same pull request.
- Release automation is handled by release-please. Release-please pull requests
  are read-only for code agents unless the maintainer explicitly takes release
  action.

When a decision changes CLI behavior, Action inputs, report schemas, rule
semantics, security posture, or release mechanics, add or update an ADR instead
of relying only on a pull request comment.

## Maintainer Responsibilities

The maintainer is responsible for:

- Keeping the Linear BOARD queue current.
- Reviewing roadmap scope, breaking changes, and user-facing contracts.
- Maintaining CODEOWNERS, CI requirements, branch protection, release
  configuration, and package ownership.
- Triaging security reports and dependency alerts.
- Keeping generated docs, bundles, notices, and schemas in sync with source
  changes.

Automation can run validation and merge eligible changes, but the maintainer owns
policy decisions and external GitHub settings.

## Review Model

Every pull request targeting `main` must pass the required CI gates. Because the
repository currently has one maintainer, the branch ruleset enforces zero
required human approvals. All review conversations must still be resolved before
merge, and the maintainer must inspect automated review, security, coverage, and
CI evidence before making the merge decision.

When a second trusted maintainer with repository write access is onboarded,
revisit this policy and consider requiring one independent approval. Until then,
requiring the sole author to obtain an impossible independent review would block
normal maintenance without adding a real control.

The administrator role retains a PR-only emergency bypass for exceptional
ruleset or CI infrastructure failures; it does not permit direct pushes to
`main`. Use the bypass only when delaying a material security, release, or
availability fix is riskier than proceeding. The pull request must have all
available checks green, carry `manual-review`, and document the reason, scope,
and rollback plan. Record a retrospective review within two business days and
open follow-up issues for any findings.

Release Please, Renovate, and other automation may create and update pull
requests. Their pull requests do not require a human approval while the project
is single-maintainer, but they must pass the same required checks, resolve all
review conversations, and receive an explicit maintainer merge decision.

## CODEOWNERS

The repository has a root `CODEOWNERS` file that currently assigns all files to
`@oaslananka`. GitHub supports CODEOWNERS files in `.github/`, repository root,
or `docs/`; if multiple files exist, GitHub uses the first match in that order.

Policy:

- Keep exactly one active CODEOWNERS file unless the maintainer intentionally
  changes ownership layout.
- Include ownership for governance and repository settings files.
- CODEOWNERS review is not required while the only code owner is also the sole
  maintainer, because it would not create an independent review path. Revisit
  this setting when a second maintainer or security owner is added.
- Do not use CODEOWNERS as a substitute for CI or branch protection.

## Branch And Merge Policy

`main` is the integration branch. Contributors and agents should work from
short-lived branches and open pull requests back to `main`.

Required policy:

- No force-push to `main`.
- No deletion of `main`.
- No direct pushes to `main`; emergency changes still use a pull request and
  the documented PR-only bypass.
- Squash merge is the normal merge method.
- Delete topic branches after merge.
- One Linear issue per pull request.
- Release, tag, and package-publish actions are maintainer-owned.

## Branch Protection

The committed repository ruleset at `.github/rulesets/main.json` is the source
of truth for `main`. It requires signed commits, zero required human approvals while the project is
single-maintainer, stale-review dismissal, resolved review conversations, strict
stable status checks, linear history, and squash-only merging. The admin bypass is limited to pull requests.

Apply or update the ruleset from an authenticated administrator context:

```bash
scripts/setup-branch-protection.sh oaslananka/boardreadyops main
```

Verify the live configuration with:

```bash
gh api repos/oaslananka/boardreadyops/rulesets
```

Ruleset changes must land in the repository before the live setting is updated,
then the live response must be compared with the committed JSON.
