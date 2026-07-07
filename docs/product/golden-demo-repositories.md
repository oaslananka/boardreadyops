# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

## Demo repository set

| Repository | Purpose | Expected result |
| --- | --- | --- |
| boardreadyops-demo-pass | Minimal KiCad project with complete release evidence. | Pass |
| boardreadyops-demo-fail | Same project with intentional readiness defects. | Fail |
| boardreadyops-demo-progressive | Branches showing prototype, assembly-ready, and production progression. | Mixed |

## Required scenarios

### Passing PR

- Valid KiCad project structure.
- BOM and manufacturing files present.
- Release manifest present.
- Evidence bundle can be generated.
- GitHub check passes and links to hosted dashboard.

### Failing PR

- Missing or stale manufacturing artifact.
- BOM risk or missing approved alternate.
- Missing release manifest/checksum coverage.
- GitHub check fails with product-quality summary and clear top findings.

### Progressive PR

- Prototype mode starts advisory.
- Assembly-ready mode tightens handoff checks.
- Production mode requires complete release evidence.

## Repository requirements

- Public repositories under `oaslananka`.
- Small fixture files only; no private customer board data.
- README explains how to trigger a passing and failing PR.
- Branches are named consistently:
  - `demo/pass`
  - `demo/fail`
  - `demo/prototype`
  - `demo/assembly-ready`
  - `demo/production`
- Each demo PR should link back to the BoardReadyOps documentation.

## Acceptance criteria

- A new user can open the demo PRs and understand the value in under two minutes.
- Passing and failing checks both link to hosted run dashboards.
- Findings are intentionally understandable, not noisy.
- Demo repositories avoid secrets, credentials, and proprietary hardware data.
