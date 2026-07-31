# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

## Demo repository set

| Repository | Live proof | Purpose | Expected result |
| --- | --- | --- | --- |
| [`oaslananka/boardreadyops-demo-pass`](https://github.com/oaslananka/boardreadyops-demo-pass) | [`demo/pass` PR #1](https://github.com/oaslananka/boardreadyops-demo-pass/pull/1) | Broken baseline repaired with complete BOM and manufacturing evidence. | **Expected pass** |
| [`oaslananka/boardreadyops-demo-fail`](https://github.com/oaslananka/boardreadyops-demo-fail) | [`demo/fail` PR #1](https://github.com/oaslananka/boardreadyops-demo-fail/pull/1) | Clean baseline changed to show design, BOM, and missing-output blockers. | **Expected fail** |

Both public repositories use synthetic CC0 fixtures, SHA-pinned workflow dependencies, sticky PR reviews, annotations, and downloadable JSON, SARIF, and Markdown workflow artifacts. The repository-local `examples/scenarios/` corpus continues to provide prototype-ready and production-ready progression without creating a third public repository that would duplicate maintenance.

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
- Passing and failing PR reviews both link to authoritative Actions runs and workflow artifacts.
- Findings are intentionally understandable, not noisy.
- Demo repositories avoid secrets, credentials, and proprietary hardware data.
