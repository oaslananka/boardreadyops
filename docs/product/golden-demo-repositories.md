# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

The former standalone demo repositories are no longer maintained. Instead, we
reuse one existing public GitHub App installation and one test repository:
[boardreadyops/boardreadyops-e2e-public](https://github.com/boardreadyops/boardreadyops-e2e-public).
Two live PRs on synthetic KiCad/BOM fixtures passed their required
source/Actions/App evidence checks on 2026-11-01.

## Verified public demo set

| Example | GitHub PR | Verified App verdict | Actions report |
| --- | --- | --- | --- |
| Corrected board | [PASS PR #4](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/4) | [PASS — 0 findings](https://boardreadyops.com/runs/9ab5ab15-0db0-4b22-b923-ac434da4ebee), SHA `6e5e4e563eed238b5a2c0b9582f8a86a431a8c27` | [Successful workflow and downloadable artifact](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347650029) |
| Broken board | [BLOCK PR #5](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/5) | [BLOCK — 6 high, 2 medium records](https://boardreadyops.com/runs/74c7f60f-0779-4f48-bfe0-2fc07360565b), SHA `dbb4105762b64fca53ac51dbfd752ea8baaa6e36` | [Failed workflow (intentional blockers) and downloadable artifact](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347645773) |

The underlying broken fixture contains five **distinct** hardware finding types;
the current App reporting path repeats some of them. The source fixtures
remain independently reproducible at
[broken](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/broken)
and [fixed](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/fixed).
The automated regression test `tests/unit/examples/golden-demo.test.ts`
asserts these local findings. Neither hosted demonstration is a customer
fabrication attestation or evidence of a physical production release.

## Required scenarios

### Passing PR

- Valid KiCad project structure.
- BOM and manufacturing files present.
- Versioned JSON and Markdown evidence snapshots are present.
- JSON, SARIF, and Markdown workflow artifacts are generated.
- GitHub check passes and links to the authoritative Actions run and workflow artifacts.

### Failing PR

- Missing or stale manufacturing artifact.
- BOM risk or missing approved alternate.
- Missing release manifest/checksum coverage.
- GitHub check fails with product-quality summary and clear top findings.

### Progressive PR

Not built. The prototype, assembly-ready, and production progression lives in the
repository-local `examples/scenarios/` corpus instead. Three more public repositories, or
three more branches nobody opens, would cost maintenance without showing anything the
scenarios do not.

## Repository requirements

- Public demo repository under the dedicated `boardreadyops` GitHub account.
- Small fixture files only; no private customer board data.
- README explains how to trigger a passing and failing PR.
- PASS/BLOCK demo branches stay open and are explicitly labelled as synthetic tests.
  No misleading production or independent attestation claim is made.
- Each demo PR should link back to the BoardReadyOps documentation.

## Acceptance criteria

- A new user can open the demo PRs and understand the value in under two minutes.
- Passing and failing PR reviews both link to authoritative Actions runs and workflow artifacts.
- Findings are intentionally understandable, not noisy.
- Demo repositories avoid secrets, credentials, and proprietary hardware data.
