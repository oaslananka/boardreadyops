# Repository Maturity Report

Audit date: 2026-07-02  
Repository: `oaslananka/boardreadyops`  
Mode: audit plus low-risk implementation pull request

## Executive summary

BoardReadyOps is already above basic open-source hygiene. It has a clear README,
MIT license, contribution guide, code of conduct, security policy, changelog,
issue templates, PR template, CODEOWNERS, extensive CI, release automation,
security scanning, SBOM/provenance work, and high local test coverage.

The current maturity classification is **Professional OSS / Mature OSS** with a
the right target for a solo-maintainer project. Gold or foundation-grade maturity is not a current goal. The main
remaining gaps are sustained human review, independent maintainers/contributors if the project later expands, required status checks on `main`,
OpenSSF Best Practices evidence completion, an explicit trusted-plugin execution model, and resilient docs accessibility checks.

## Current maturity level

**Professional OSS / Mature OSS, partial.**

Evidence:

- GitHub Community profile API returned `100` during this audit.
- Local validation already includes lint, typecheck, unit/integration/action/
  property/snapshot tests, coverage, build, dist verification, structure checks,
  license checks, SBOM, release-channel verification, and security workflow
  coverage.
- Local coverage run reported approximately 98% statements and 92% branches.
- GitHub `main` is branch-protected with one required approval and CODEOWNERS
  review enabled, but required status checks were not configured in the branch
  protection API response observed during this audit.
- Contributor API output showed one human contributor and one bot account, so
  bus factor and independent review are still the largest maturity gaps.

## Target maturity level

**Primary target: Professional OSS / Mature OSS.**

Gold/foundation-grade is **not a current target** for this solo-maintainer project. Revisit it only if all of these
conditions become true:

- Multiple active maintainers.
- Independent human contributor/reviewer activity.
- Regular human PR review for sensitive changes.
- Branch protection with required status checks and CODEOWNERS review enforced.
- Sustainable governance and release ownership.
- Repeatable, reproducible release evidence.

## GitHub Community Standards status

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| README | Passed | `README.md` exists and covers positioning, install, Action, CLI, config, checks, and development. |
| LICENSE | Passed | MIT `LICENSE` exists. |
| CONTRIBUTING | Passed | `CONTRIBUTING.md` documents setup, validation, PR process, rule/report guidance, and Conventional Commits. |
| CODE_OF_CONDUCT | Passed | `CODE_OF_CONDUCT.md` exists. |
| SECURITY | Passed | `SECURITY.md` exists; disclosure docs also live under `docs/security/`. |
| SUPPORT | Passed | `SUPPORT.md` added by this maturity PR. |
| Issue templates | Passed | Existing templates plus explicit `bug_report.yml` and `feature_request.yml` added. |
| Pull request template | Passed | Existing lowercase template retained; uppercase `.github/PULL_REQUEST_TEMPLATE.md` added for compatibility with standard naming. |
| CODEOWNERS | Passed | `.github/CODEOWNERS` exists and was hardened. |

## OpenSSF Best Practices status

| Area | Status | Evidence / gap |
| --- | --- | --- |
| Badge project | Partial | README links to Best Practices project `13378`; BadgeApp remains the source of truth. |
| `.bestpractices.json` | Passed | Added repository-local metadata pointing to evidence docs and BadgeApp project. |
| Passing readiness | Partial | Most repository hygiene exists; human-entered BadgeApp criteria still need maintainer confirmation. |
| Silver readiness | Partial | Security, CI, tests, docs, and release evidence are strong; independent review and governance evidence need strengthening. |
| Gold feasibility | Not applicable | Not a current target for a solo-maintainer project; keep only as future gap analysis. |
| Evidence files | Passed | `docs/openssf-evidence.md`, `docs/openssf-gap-analysis.md`, and `docs/openssf-proposal-links.md` added. |

## Scorecard readiness

| Check | Status | Evidence / gap |
| --- | --- | --- |
| Branch protection | Partial | `main` protection exists with one approval and CODEOWNERS review; required status checks are now configured; review the exact context list after workflow renames. |
| Code review | Partial | Branch rule requires approval, but contributor history is mostly solo/bot. Independent human review is not yet proven. |
| Maintained | Passed | Recent commits, releases, and scheduled workflows are active. |
| Security policy | Passed | `SECURITY.md` exists. |
| License | Passed | MIT license present. |
| CI tests | Passed | `ci.yml`, `lint-fast.yml`, `self-smoke.yml`, `dist-check.yml`, docs, container, and validation workflows exist. |
| Dependency update tool | Passed | Dependabot-style update activity/workflow evidence exists in recent runs; verify repository settings. |
| Pinned dependencies | Passed | Workflows use pinned actions and tests enforce action pinning. |
| Token permissions | Passed | Workflows use constrained permissions in reviewed files. |
| Dangerous workflows | Passed | Security workflow includes dangerous-workflow scanning via `zizmor`/policy checks. |
| SAST | Passed | CodeQL is present through `security.yml`. |
| Fuzzing | Partial | Property tests and mutation testing exist; no dedicated fuzzing service claim is made. |
| Binary artifacts | Partial | `dist/` bundles are intentionally committed for Action/npm consumption and are verified by `verify:dist`; document the exception clearly. |

## Documentation maturity

| Diataxis category | Status | Evidence / gap |
| --- | --- | --- |
| Tutorial | Passed | `docs/tutorials/getting-started.md` added; quickstart and golden demo already exist. |
| How-to | Passed | `docs/how-to/ci-quality-gates.md` added; many focused how-to docs already exist. |
| Reference | Passed | `docs/reference/repository-standards.md` added; CLI/rules/schema/report docs already exist. |
| Explanation | Passed | `docs/explanation/architecture.md` added and links to existing architecture docs. |
| Discoverability | Partial | MkDocs nav is strong; continued consolidation around Diataxis will help new contributors. |

## Release maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| Semantic Versioning | Passed | Release-please and version verification are configured. |
| CHANGELOG | Passed | `CHANGELOG.md` exists and release history is generated. |
| GitHub Releases | Passed | Latest release `v1.7.2` has binary assets, `SHA256SUMS`, and SBOM. |
| Checksums | Passed | Release assets include `SHA256SUMS`; installers verify checksums. |
| Provenance / attestation | Passed | Workflows and docs cover provenance and artifact attestation. |
| Reproducibility | Partial | Dist and binary verification exist; independent reproducible-build attestation remains a future hardening item. |

## Quality maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| Lint | Passed | `pnpm run lint` passed locally. |
| Typecheck | Passed | `pnpm run typecheck` passed locally. |
| Unit tests | Passed | `pnpm run test:unit` passed locally. |
| Integration tests | Passed | `pnpm run test:int` passed locally. |
| Coverage | Passed | `pnpm run coverage` passed with high coverage. |
| Mutation testing | Partial | Score is above threshold, but nightly currently fails because a type-only file is treated as missing executable mutation coverage. |
| Docs accessibility | Partial | `docs:a11y` can fail with Puppeteer connection flake; should be hardened. |
| Quality gate policy | Passed | Required validation is documented in `CONTRIBUTING.md` and CI workflows. |

## Governance maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| GOVERNANCE | Passed | `GOVERNANCE.md` exists. |
| MAINTAINERS | Passed | `MAINTAINERS.md` added. |
| ROADMAP | Passed | Roadmap exists at `docs/ROADMAP.md`; root `ROADMAP.md` intentionally not duplicated. |
| CODEOWNERS | Passed | `.github/CODEOWNERS` hardened. |
| Support policy | Passed | `SUPPORT.md` added. |
| Deprecation policy | Partial | Release/process docs exist; explicit deprecation/backward compatibility policy should be expanded. |
| Human review | Partial | Branch protection requires approval, but independent sustained review is not yet demonstrated. |

## Community maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| Issue templates | Passed | Existing and new templates cover bugs, features, RFCs, rules, vendors. |
| PR process | Passed | PR templates and contribution docs exist. |
| Contributor activity | Partial | Current contributor history is mostly one human maintainer plus automation. |
| Time to first response | Needs human confirmation | No SLA metrics were calculated; add issue/PR analytics if community grows. |
| Bus factor | Partial | Single-maintainer status is documented. |
| Change acceptance process | Passed | Contribution and governance docs describe required validation and review expectations. |

## License/legal maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| License | Passed | MIT. |
| SPDX/REUSE | Partial | REUSE check exists; per-file SPDX completeness should remain tracked by `check:reuse`. |
| Third-party license awareness | Passed | License check and NOTICE generation exist. |
| NOTICE | Passed | NOTICE refreshed in this PR to match current lockfile. |
| Dependency license policy | Passed | Development docs now include dependency management policy. |

## Security/supply-chain maturity

| Criterion | Status | Evidence / gap |
| --- | --- | --- |
| SECURITY policy | Passed | Present. |
| Private vulnerability reporting | Needs human confirmation | Enable/verify GitHub private vulnerability reporting in repository settings. |
| CodeQL | Passed | Covered by security workflow. |
| Gitleaks | Passed | Covered by security workflow. |
| Dependency review | Passed | Covered by security workflow for PR context; settings should be verified. |
| OSV scanner | Passed | Covered by security workflow. |
| SBOM | Passed | SBOM scripts and release assets exist. |
| SLSA/provenance | Passed | Provenance/attestation workflows and docs exist. |
| Minimal permissions | Passed | Workflows use explicit permissions; continue auditing new workflows. |
| Plugin runtime sandbox | Missing | Plugin permissions are declaration-level; runtime sandboxing remains a risky change not applied here. |

## Missing files

Files added by this PR:

- `SUPPORT.md`
- `MAINTAINERS.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.bestpractices.json`
- OpenSSF/maturity evidence docs
- Diataxis-aligned documentation entry points
- Development and supply-chain documentation

Files intentionally not added:

- Root `CODEOWNERS`: `.github/CODEOWNERS` is the active GitHub-supported file.
- Root `ROADMAP.md`: `docs/ROADMAP.md` is the canonical roadmap and is linked from README/MkDocs.

## Missing workflows

No new workflow was added in this PR because the repository already has a broad
workflow set: CI, lint-fast, security, trivy, CodeQL within security, gitleaks
within security, dependency review within security, release-please, publish-npm,
provenance, docs, container build, dist-check, mutation-nightly, self-smoke, and
self-validation.

Creating duplicate `codeql.yml`, `gitleaks.yml`, `dependency-review.yml`, or
`scorecard.yml` would increase maintenance burden without improving maturity.
Recommended workflow follow-up: ensure branch protection requires the correct
existing check names.

## Risky changes not applied

- Runtime plugin sandbox implementation; v1 now documents plugins as trusted-code execution instead.
- Changing release/publish workflow behavior.
- Enforcing branch protection or repository rules through API.
- Adding or changing required status checks.
- Changing public JSON schemas beyond documentation.
- Reworking PR review automation or merge automation.

## Recommended issues

1. [#2](https://github.com/oaslananka/boardreadyops/issues/2) Implement runtime plugin isolation or mark plugins as trusted-code execution.
2. [#3](https://github.com/oaslananka/boardreadyops/issues/3) Done in this PR: mutation-nightly type-only file handling fixed for `src/core/config.types.ts`.
3. [#4](https://github.com/oaslananka/boardreadyops/issues/4) Done in this PR: `docs:a11y` retries transient Puppeteer browser/page failures.
4. [#5](https://github.com/oaslananka/boardreadyops/issues/5) Done outside code in repo settings: required status checks configured on `main` branch protection.
5. Add explicit deprecation and backward compatibility policy.
6. Add maintainer/contributor growth plan for independent review coverage.
7. Add Scorecard/Best Practices evidence refresh automation.
8. Evaluate reproducible binary release verification beyond checksums and attestations.

## Next actions

1. Merge this low-risk maturity documentation PR after human review.
2. Enable/verify manual GitHub repository settings listed in the PR.
3. Open or link issues for risky follow-ups.
4. Submit or update OpenSSF Best Practices BadgeApp answers using
   `docs/openssf-evidence.md`.
5. Re-run `pnpm run security`, `pnpm run docs`, and relevant CI after merge.
