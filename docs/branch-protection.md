# Branch Protection

The active `main` branch policy is stored as code in
`.github/rulesets/main.json`. The ruleset requires signed commits, zero required
human approvals while the repository has a single maintainer, resolved review
conversations, strict stable checks, and squash-only merges. Stale-review
dismissal remains enabled so the policy can be tightened without changing its
baseline semantics.

CODEOWNERS continues to record ownership, but CODEOWNERS review is not required
while `@oaslananka` is the sole maintainer. Trusted automation can open and
update pull requests; the maintainer must still inspect bot, agent, security, and
CI feedback before merge.

The repository administrator role has a PR-only emergency bypass for exceptional
ruleset or CI infrastructure failures. Direct pushes remain blocked. Every
bypass requires available checks to be green, a documented reason and rollback
plan, the `manual-review` label, and a retrospective review within two business
days.

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
