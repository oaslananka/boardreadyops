# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

Both repositories exist and their pull requests are live. What follows records what was built and what was deliberately left out.

## Demo repository set

| Repository | Live proof | Purpose | Expected result |
| --- | --- | --- | --- |
| [`oaslananka/boardreadyops-demo-pass`](https://github.com/oaslananka/boardreadyops-demo-pass) | [PR #1](https://github.com/oaslananka/boardreadyops-demo-pass/pull/1) (`fix/board-outline-and-bom`) | Broken baseline repaired: closed outline, unique designators, sourced and compliant BOM. | **Expected pass** |
| [`oaslananka/boardreadyops-demo-fail`](https://github.com/oaslananka/boardreadyops-demo-fail) | [PR #1](https://github.com/oaslananka/boardreadyops-demo-fail/pull/1) (`chore/layout-tweak`) | Clean baseline broken by a change that reads as routine housekeeping. | **Expected fail** |

Both repositories carry the `examples/golden-demo` corpus under the project's own MIT licence, pin the published Action to a commit SHA, and produce the sticky PR comment, workflow annotations, and downloadable JSON, SARIF, and Markdown artifacts. Each also ships `readiness-runner.yml`, so installing the GitHub App on them lights up the hosted review with no further setup. The repository-local `examples/scenarios/` corpus continues to provide prototype-ready and production-ready progression without creating a third public repository that would duplicate maintenance.

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
