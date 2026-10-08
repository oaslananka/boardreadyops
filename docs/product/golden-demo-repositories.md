# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

The original external demo repositories and their pull requests were not available
at verification on 2026-10-08. The reproducible, public source fixtures below
remain the current demonstration authority; rebuilding externally hosted PR demos
requires separate provisioning, action pinning and live-check acceptance.

## Available demo set

| Fixture | Source | Expected result |
| --- | --- | --- |
| Broken board | [examples/golden-demo/broken](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/broken) | **Expected fail** — five findings |
| Fixed board | [examples/golden-demo/fixed](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/fixed) | **Expected pass** — no findings |

The synthetic fixtures are checked by `tests/unit/examples/golden-demo.test.ts`
and can be run without KiCad CLI. A real GitHub pull request demo is a separate
product acceptance gate; source fixtures alone do not prove Check Run, PR comment
or workflow artifact publication.

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

- Public repositories under `oaslananka`.
- Small fixture files only; no private customer board data.
- README explains how to trigger a passing and failing PR.
- Branches are named the way a real change would be named, not after the demo. The failing
  demo only works if its branch and commit read as ordinary housekeeping: `chore/layout-tweak`
  in `boardreadyops-demo-fail`, `fix/board-outline-and-bom` in `boardreadyops-demo-pass`.
  A branch called `demo/fail` tells the reader the answer before the check does.
- Each demo PR should link back to the BoardReadyOps documentation.

## Acceptance criteria

- A new user can open the demo PRs and understand the value in under two minutes.
- Passing and failing PR reviews both link to authoritative Actions runs and workflow artifacts.
- Findings are intentionally understandable, not noisy.
- Demo repositories avoid secrets, credentials, and proprietary hardware data.
