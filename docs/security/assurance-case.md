# Assurance Case

This assurance case explains why a maintainer or user can have confidence in a
BoardReadyOps release, and where confidence is still limited.

## Claim 1: The repository has professional OSS hygiene

Evidence:

- README, license, contributing guide, code of conduct, security policy, support
  policy, governance, maintainer file, issue templates, PR templates, and
  CODEOWNERS are present.
- GitHub Community profile API returned `100` during the 2026-07-02 audit.

Residual risk:

- Single-maintainer project; independent review is limited.

## Claim 2: Changes are checked by automated quality gates

Evidence:

- Lint, typecheck, test, coverage, build, dist verification, structure checks,
  docs build, license checks, security checks, and release verification scripts
  exist.
- Local audit ran core validation successfully, except documented follow-up gaps.

Residual risk:

- Required status checks need repository settings confirmation.
- Mutation-nightly currently has a type-only file false failure.
- Docs accessibility check can flake due to browser connection closure.

## Claim 3: Release artifacts can be verified

Evidence:

- Release assets include checksums and SBOM.
- npm provenance and artifact attestation workflows are documented.
- Install scripts verify checksums.
- Same-machine reproducibility is verified: `pnpm run verify:reproducible-build`
  rebuilds `dist/action/index.cjs` and `dist/cli/index.cjs` in a detached git
  worktree with a fresh, frozen-lockfile `node_modules` and SHA-256-compares the
  result against the checked-in bundle. Release manifests can be signed and
  verified against a rotation/revocation-aware trust store
  (`release verify --trust-store`), not just a single pinned key.

Residual risk:

- Cross-OS and cross-CI-runner reproducibility is not yet proven, only
  same-machine independence.
- Secure distribution of trust store *updates* to a consumer's machine (a
  signed trust-store bundle, TUF-style delegation) is not yet designed.

## Claim 4: Security posture is actively maintained

Evidence:

- Security disclosure process exists.
- CodeQL, gitleaks, dependency review, OSV, Trivy, SBOM, and Scorecard evidence
  are present in workflows and docs.
- `tests/integration/security-adversarial.test.ts` (11 passing cases) exercises
  cross-tenant tampering, Stripe webhook signature verification and replay
  rejection, stored-XSS escaping, path traversal in artifact keys, tenant-scoped
  DB query enforcement, evidence-ledger tamper detection, and
  incomplete-check-cannot-go-green.
- Webhook notifier configuration that resolves to an unrecognized environment
  variable name is logged as a warning (`notifier.webhook.unrecognized-env-name`)
  rather than silently redirecting delivery data — see
  [Threat model](threat-model.md).

Residual risk:

- Private vulnerability reporting and sensitive-data scanning settings require
  maintainer confirmation.
- Plugins are explicitly documented as trusted-code execution in v1; runtime sandboxing is optional future hardening.
- No dedicated GA-readiness penetration-test checklist document exists yet.
