# Branch Protection

The live GitHub ruleset named `main-standard` protects the default branch.
`.github/rulesets/main.json` records the intended policy. The live ruleset
requires zero human approvals while the repository has a single maintainer,
resolved review conversations, ten strict required checks, linear history,
and squash-only merges. Force pushes and branch deletion are blocked.
A separate commit-signature requirement is not enabled.

CODEOWNERS records ownership, but CODEOWNERS approval is not required in the
single-maintainer model. Mergify provides an explicit manual-only serial queue,
without automatic admission or a ruleset bypass.

Only the repository owner has a PR-only emergency bypass. It is a human
break-glass action in the GitHub UI, never an agent or automation capability.
Direct pushes remain blocked. The owner must record the reason and rollback
plan, use `manual-review`, verify available checks, and record a retrospective
within two business days.

## Check protection (read-only)

```bash
scripts/setup-branch-protection.sh oaslananka/boardreadyops main-standard
```

Use a trusted local Node.js and GitHub CLI installation. The helper invokes GitHub
CLI by absolute path, not through PATH or repository files. Common system
installation paths are detected automatically; for a different installation,
set `BOARDREADYOPS_GH_PATH` to its trusted absolute executable path (outside
the checkout). Do not select an executable from an untrusted directory.

The helper checks the authenticated repository identity and the complete
repository ruleset inventory. A missing, legacy, duplicate, unrecognized, or
stronger live branch ruleset fails closed instead of being overwritten.
The helper never creates a ruleset or changes repository-wide merge settings.

## Known drift and explicit repair

As verified on 2026-11-27, live stale-review dismissal is disabled even
though the committed policy requires it. The read-only command reports this
difference with a nonzero exit status. All ten required checks and the
owner-only bypass remain intact. After the source change is reviewed and
merged, the authorized maintainer can explicitly request the strengthening:

```bash
scripts/setup-branch-protection.sh oaslananka/boardreadyops main-standard --apply
```

This operation updates the existing ruleset only if its sole difference
from the committed policy is disabled stale-review dismissal. It rechecks
the ruleset before the update and verifies the result afterwards. Do not run
concurrent settings changes; the REST update is not an atomic compare-and-swap.
Other differences require manual review and a separately reviewed policy
change. The helper does not repair missing rulesets or alter release-tag rules.

## Inspect the live configuration

```bash
gh api repos/oaslananka/boardreadyops/rulesets
gh api repos/oaslananka/boardreadyops/rulesets/<id>
```

Compare approval, review-thread, bypass, merge-method, and required-check
configuration against the committed policy. See [CI policy](development/ci-policy.md)
for the required contexts.
