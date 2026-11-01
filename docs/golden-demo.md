# Golden demo

The golden demo is a tiny, self-contained corpus that shows BoardReadyOps catching realistic release problems on a broken board and then confirming a fixed board is clean. It ships in the repository under [`examples/golden-demo`](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo) and is part of the [BoardReadyOps v2 roadmap](https://github.com/oaslananka/boardreadyops/issues/192).

## Reproducible source demos

The public source fixtures are part of this repository. Inspect
[the blocked board](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/broken)
and [the corrected board](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo/fixed).
They demonstrate **expected fail** and **expected pass** outcomes without needing credentials or a hosted service.

## WARN, policy and changed-component walkthroughs

The live public GitHub App demonstrations cover **PASS** and **BLOCK**. The
additional **WARN** example is a reproducible checked-in **CLI report**, not a
hosted App WARN Check Run:

- [Prototype-ready scenario report](https://github.com/oaslananka/boardreadyops/blob/main/examples/scenarios/prototype-ready/report.json):
  one medium `manufacturing.fab-notes` finding, no high-severity blocker;
  `readiness.status=at-risk` and `summary.failed=false` under the configured
  `fail-on: high` threshold. [Inspect source and config](https://github.com/oaslananka/boardreadyops/tree/main/examples/scenarios/prototype-ready).
- [Blocked lifecycle/policy scenario report](https://github.com/oaslananka/boardreadyops/blob/main/examples/scenarios/failing-pr/report.json):
  high findings include `bom.eol-detection` (NRND component), `bom.missing-mpn`
  and `bom.compliance`; non-blocking supply-risk findings also appear.
  [Inspect config](https://github.com/oaslananka/boardreadyops/blob/main/examples/scenarios/failing-pr/boardreadyops.yml).
- [Golden broken vs fixed rule inventory](https://github.com/oaslananka/boardreadyops/blob/main/examples/golden-demo/expected-findings.json):
  the paired fixtures change the open board outline, duplicate reference,
  missing MPN and non-compliant BOM row. The fixed fixture has zero findings.
  This is a reproducible before/after *fixture comparison*, not an authenticated
  customer revision history.

All three examples are synthetic. They illustrate evidence and policy behavior;
they do not claim customer manufacturing attestation, an independent
source-to-Gerber proof, or a third native GitHub App WARN verdict.

## Verified public GitHub pull requests

The original standalone demo repositories were retired. Two **public, synthetic**
pull requests now live in the existing
[boardreadyops/boardreadyops-e2e-public](https://github.com/boardreadyops/boardreadyops-e2e-public)
test repository. They use a pinned BoardReadyOps Action and the real BoardReadyOps GitHub App
for an end-to-end verdict, without private customer board data:

- [PASS PR #4](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/4):
  [GitHub App check PASS, zero findings](https://boardreadyops.com/runs/9ab5ab15-0db0-4b22-b923-ac434da4ebee);
  [Actions and downloadable report](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347650029).
  Verified head: `6e5e4e563eed238b5a2c0b9582f8a86a431a8c27`.
- [BLOCK PR #5](https://github.com/boardreadyops/boardreadyops-e2e-public/pull/5):
  [GitHub App check BLOCK](https://boardreadyops.com/runs/74c7f60f-0779-4f48-bfe0-2fc07360565b);
  [Actions and downloadable report](https://github.com/boardreadyops/boardreadyops-e2e-public/actions/runs/41347645773).
  Verified head: `dbb4105762b64fca53ac51dbfd752ea8baaa6e36`.
  The hosted App reports six high and two medium records because some source
  findings appear twice; the underlying golden fixture reproduces **five distinct
  finding types** (four high and one medium).

The PRs are deliberately **left open and unmerged** for inspection. Their source,
PR comments, native App Check Runs, workflow logs and Actions artifacts are
independently inspectable. These are illustrative test boards, **not** independently
attested source-to-fabrication evidence, real customer manufacturing acceptance,
or proof of a delivered production board.

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
