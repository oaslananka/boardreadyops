# Golden demo repositories

Issue: #15

## Goal

Create public demonstration repositories that show BoardReadyOps producing both failing and passing hardware release readiness results.

The original external demo repositories were unavailable on 2026-10-08. Instead of
recreating them, the existing public [boardreadyops-e2e-public](https://github.com/boardreadyops/boardreadyops-e2e-public)
repository now hosts two real PRs against the synthetic golden fixtures. On 2026-11-01,
the BoardReadyOps **GitHub App** (not the unrelated GitHub Advanced Security scan)
completed its native release-readiness Check Runs on both exact heads, and GitHub Actions
published report artifacts. These tests prove the public demonstration workflow only:
no private/customer board, signed manufacturing export or external customer acceptance is implied.

| Public PR | Native App outcome | Target Actions outcome | Evidence |
| --- | --- | --- | --- |
| [PASS #4](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/4) | Success, 0 findings | [Success, report artifact](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347951847) | [Cloud Check Run](https://boardreadyops.com/runs/6d1bab08-527a-47fa-99c4-f778f02714a8) |
| [BLOCK #5](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/5) | Failure, 4 high + 1 medium | [Expected failure, report artifact](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347954172) | [Cloud Check Run](https://boardreadyops.com/runs/889f9d24-0425-4f63-8eb5-1446cc93a9ef) |

Both PRs intentionally remain open and unmerged so visitors can inspect the actual outcomes.

## Available demo set

| Fixture | Source | Expected result |
| --- | --- | --- |
| Broken board | [examples/golden-demo/broken](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/broken) | **Expected fail** — five findings |
| Fixed board | [examples/golden-demo/fixed](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/fixed) | **Expected pass** — no findings |

The synthetic fixtures are checked by `tests/unit/examples/golden-demo.test.ts`
and can be run without KiCad CLI. The linked public PRs above demonstrate native App checks, PR comments and workflow
artifacts; source fixtures **alone** would not prove those hosted outcomes.

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
