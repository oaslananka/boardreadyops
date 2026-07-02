## Summary

Describe the change and its user-visible impact.

## Related issue / milestone

Link the GitHub issue, for example `Closes #123`.
Target milestone: <!-- v1.x / v2.x / Backlog -->

## Validation

Record every command run and mark pass/fail.

- [ ] `corepack pnpm install --frozen-lockfile`
- [ ] `corepack pnpm run lint`
- [ ] `corepack pnpm run typecheck`
- [ ] `corepack pnpm run test`
- [ ] `corepack pnpm run build`
- [ ] `corepack pnpm run verify:dist`

Additional validation when relevant:

- [ ] `corepack pnpm run docs`
- [ ] `corepack pnpm run coverage`
- [ ] `corepack pnpm run security`
- [ ] `corepack pnpm run verify:structure`
- [ ] `corepack pnpm run verify:release-channels`

## Maturity impact

- [ ] Documentation updated or verified unnecessary.
- [ ] Tests, coverage, or quality gates updated or verified unnecessary.
- [ ] Release, package, or provenance docs updated or verified unnecessary.
- [ ] Security, license, or supply-chain docs updated or verified unnecessary.
- [ ] Governance/community docs updated or verified unnecessary.

## Risk

Risk level: <!-- Low / Medium / High -->

Explain compatibility, migration, release, or operational risk.

## Human review required

Yes. Public contract, release, governance, security, and workflow changes require
maintainer review even when automated checks pass.
