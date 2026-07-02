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

Residual risk:

- Independent reproducible binary builds are not yet proven.

## Claim 4: Security posture is actively maintained

Evidence:

- Security disclosure process exists.
- CodeQL, gitleaks, dependency review, OSV, Trivy, SBOM, and Scorecard evidence
  are present in workflows and docs.

Residual risk:

- Private vulnerability reporting and sensitive-data scanning settings require
  maintainer confirmation.
- Plugins are explicitly documented as trusted-code execution in v1; runtime sandboxing is optional future hardening.
