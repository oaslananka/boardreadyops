# Golden demo

The golden demo is a tiny, self-contained corpus that shows BoardReadyOps catching realistic release problems on a broken board and then confirming a fixed board is clean. It ships in the repository under [`examples/golden-demo`](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo) and is part of the [BoardReadyOps v2 roadmap](https://github.com/oaslananka/boardreadyops/issues/192).

## Live pull request demos

Two public repositories turn the local fixture into a reviewable GitHub experience. Both carry the same synthetic hardware as `examples/golden-demo`, under the same MIT licence, and run the published Action pinned to a commit SHA. No GitHub App installation is needed to read them.

| Repository | Pull request | Check on the PR | What it shows |
| --- | --- | --- | --- |
| [`oaslananka/boardreadyops-demo-pass`](https://github.com/oaslananka/boardreadyops-demo-pass) | [PR #1 — repair the board](https://github.com/oaslananka/boardreadyops-demo-pass/pull/1) | **green** | `main` is the blocked baseline. The pull request closes the outline, deduplicates the reference designator, and sources the BOM, and readiness goes from five findings to none. |
| [`oaslananka/boardreadyops-demo-fail`](https://github.com/oaslananka/boardreadyops-demo-fail) | [PR #1 — a plausible layout tweak](https://github.com/oaslananka/boardreadyops-demo-fail/pull/1) | **red** | `main` is clean. The pull request reads as routine housekeeping and makes the board unfabricable; nothing in the diff says so, and the check does. |

Each pull request carries the Action's sticky comment: the finding list, and the fabrication diff against the base run — the BOM lines and outputs that changed, which is what a reviewer cannot get from the diff itself. JSON, SARIF, and Markdown reports upload as workflow artifacts on every run.

Both repositories also ship the target-repository `readiness-runner.yml`, so installing the GitHub App on them lights up the hosted review at `app.boardreadyops.com` without any further setup.

## Run it in two commands

```bash
boardreadyops run examples/golden-demo/broken
boardreadyops run examples/golden-demo/fixed
```

The `broken` board exits `1` with five findings, four of them blocking at the default `high` threshold; the `fixed` board exits `0`. Both projects keep DRC and ERC disabled, so the demo runs without `kicad-cli`.

## What the broken board reports

| Rule | Severity | Problem |
| --- | --- | --- |
| `design.board-outline` | high | The `Edge.Cuts` outline is open. |
| `design.unique-references` | high | A reference designator (`R1`) is used twice. |
| `bom.missing-mpn` | high | A populated BOM row has no manufacturer part number. |
| `bom.compliance` | high | A populated part is marked `Non-Compliant`. |
| `bom.risk-score` | medium | The missing MPN scores `R1` at 60/100 for supply risk. Below the `high` threshold, so it warns rather than blocks. |

The `fixed` board resolves all five and reports nothing. Each problem maps to one clear cause and one clear fix, documented in the [demo README](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo#expected-findings).

## How it stays correct

`tests/unit/examples/golden-demo.test.ts` runs the pipeline against both boards and asserts the findings exactly match `examples/golden-demo/expected-findings.json`. The expected-findings file is the single source of truth shared by the documentation and the test, so the demo cannot silently drift from what the docs promise.

## See also

- [Quickstart](quickstart.md) for running BoardReadyOps on your own project.
- [Rules](rules/index.md) for the full rule catalog behind the demo findings.
- [Demo scenarios](#demo-scenarios) for more realistic examples below.

## Demo scenarios

Three shareable, self-contained scenarios live under [`examples/scenarios/`](https://github.com/oaslananka/boardreadyops/tree/main/examples/scenarios). Each includes a `report.json` snapshot and a `README.md` explaining what it demonstrates.

| Scenario | Outcome | Demonstrates |
|----------|---------|--------------|
| [`failing-pr/`](https://github.com/oaslananka/boardreadyops/tree/main/examples/scenarios/failing-pr) | ❌ blocked | Missing MPN, non-compliant part, NRND lifecycle |
| [`prototype-ready/`](https://github.com/oaslananka/boardreadyops/tree/main/examples/scenarios/prototype-ready) | ✅ passes | Clean BOM, all components documented, non-blocking advisories only |
| [`production-ready/`](https://github.com/oaslananka/boardreadyops/tree/main/examples/scenarios/production-ready) | ✅ passes | Production mode, active waiver with owner/reason/expiry, changelog present |

### Run a scenario

```bash
boardreadyops run examples/scenarios/failing-pr
boardreadyops run examples/scenarios/prototype-ready
boardreadyops run examples/scenarios/production-ready
```

The `report.json` in each scenario directory is a pre-generated snapshot you can share as a stable link, embed in documentation, or use in sales and onboarding materials without exposing private design data.

### Keeping reports up to date

The scenario fixtures are validated by `tests/unit/examples/scenarios.test.ts`. After any rule changes, regenerate the snapshots:

```bash
boardreadyops run examples/scenarios/failing-pr --format json > examples/scenarios/failing-pr/report.json
boardreadyops run examples/scenarios/prototype-ready --format json > examples/scenarios/prototype-ready/report.json
boardreadyops run examples/scenarios/production-ready --format json > examples/scenarios/production-ready/report.json
```
