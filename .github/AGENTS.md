# CI, Security, and Release Automation Instructions

These instructions apply to `.github/**` and supplement the repository root instructions.

Workflow and ruleset edits are governance and supply-chain changes, not formatting-only YAML changes.

Read first:

- `docs/development/ci-policy.md`
- `docs/development/release-assurance.md`
- `docs/development/release-process.md`
- `docs/security/release-integrity.md`
- `docs/security/threat-model.md`
- `.github/rulesets/main.json`

## Required status checks

Preserve the live/committed required status checks unless a deliberate migration updates branch protection and its evidence.

- Do not rename, remove, path-filter away, or conditionally skip a required context in a way that leaves protection stale or permanently pending.
- Keep the risk-profile model honest. A low-risk classification must reflect the changed files, not a desire for a cheaper CI run.
- Do not use `continue-on-error`, fake-success steps, broad exclusions, or blanket suppressions to hide repository-owned failures.

## Workflow security

- Pin third-party Actions to reviewed full commit SHAs.
- Keep checkout credentials disabled unless a reviewed mutation job specifically requires them.
- Default permissions to read-only/minimal scopes; grant write or `id-token` only to the smallest reviewed job.
- Never expose publishing, signing, deployment, GitHub App, Doppler, database, or other privileged credentials to untrusted pull-request code.
- Treat shell interpolation of branch names, issue text, PR metadata, paths, or other attacker-controlled values as a trust boundary.
- Preserve actionlint/zizmor and repository security automation.

## Publishing and provenance

npm Trusted Publishing/OIDC is the normal path.

- Do not add a long-lived npm token fallback to the normal publish job.
- Preserve provenance/attestation generation and package-content verification.
- Release tag, package version, generated version, changelog, committed dist, checksums, SBOM, and attestations must refer to the same source identity.
- Do not overwrite an already published package version, retarget immutable release tags, or silently replace release assets.

## Production automation

Production deployment workflows are privileged.

- Keep environment protection, explicit operator inputs, rollback semantics, and post-deploy verification intact.
- Do not turn a rehearsal/dry-run into a production mutation.
- Secrets retrieved from managed secret storage must not be printed, persisted in source, or widened through `GITHUB_ENV` without need.
- Production topology must be verified against the commissioned runbook; do not guess host paths or container names.

## Verification

For workflow/ruleset changes run:

```bash
corepack pnpm run workflow:lint
corepack pnpm run verify:agent-instructions
```

Also run repository tests for any script or policy logic the workflow invokes. YAML parsing alone is not sufficient evidence.
