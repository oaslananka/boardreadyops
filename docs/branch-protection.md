# Branch Protection

The active `main` branch policy is stored as code in
`.github/rulesets/main.json`. The ruleset requires one independent approving
review, dismisses stale approvals after reviewable pushes, blocks unresolved
review conversations, enforces strict stable checks, and permits only squash
merges.

CODEOWNERS review is not required while the repository has a single maintainer;
the global independent-review rule remains mandatory. Trusted automation can
open and update pull requests but has no silent review bypass.

The repository administrator role has a PR-only emergency bypass. Direct pushes
remain blocked. Every bypass requires green checks, a documented reason and
rollback plan, the `manual-review` label, and a retrospective review within two
business days.

## Apply or update the ruleset

```bash
scripts/setup-branch-protection.sh oaslananka/boardreadyops main
```

The helper creates or updates the `main` repository ruleset and aligns repository
merge settings with squash-only history.

## Verify the live configuration

```bash
gh api repos/oaslananka/boardreadyops/rulesets
gh api repos/oaslananka/boardreadyops/rulesets/<id>
```

The live response must match the committed approval, review-thread, bypass,
merge-method, and required-check configuration.
