# Branch Protection

Rulesets are stored as code in `.github/rulesets/main.json` and should be applied to `main`.

## Required status checks

The protected checks are the stable, always-present CI gates:

- `ci / risk-profile`
- `ci / lint`
- `ci / typecheck`
- `ci / test-unit`
- `ci / build`
- `ci / verify-dist`
- `ci / security`

Heavy checks such as OS/Node matrix tests, KiCad integration, coverage, mutation, accessibility, and action smoke are routed by the `ci / risk-profile` job. They run when the changed files make them relevant, on main pushes, or in dedicated scheduled workflows.

## Apply or update the ruleset

```bash
gh api -X POST /repos/oaslananka/boardreadyops/rulesets --input .github/rulesets/main.json
```

If a `main` ruleset already exists, get its ID and update it:

```bash
gh api /repos/oaslananka/boardreadyops/rulesets
gh api -X PUT /repos/oaslananka/boardreadyops/rulesets/<id> --input .github/rulesets/main.json
```

## Repository merge settings

The intended merge policy is squash-only:

```bash
gh api -X PATCH /repos/oaslananka/boardreadyops \
  --field delete_branch_on_merge=true \
  --field allow_squash_merge=true \
  --field allow_merge_commit=false \
  --field allow_rebase_merge=false
```
