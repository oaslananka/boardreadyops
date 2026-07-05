# Golden demo

The golden demo is a tiny, self-contained corpus that shows BoardReadyOps catching realistic release problems on a broken board and then confirming a fixed board is clean. It ships in the repository under [`examples/golden-demo`](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo) and is part of the [BoardReadyOps v2 roadmap](https://github.com/oaslananka/boardreadyops/issues/192).

## Run it in two commands

```bash
boardreadyops run examples/golden-demo/broken
boardreadyops run examples/golden-demo/fixed
```

The `broken` board exits `1` with four blocking findings; the `fixed` board exits `0`. Both projects keep DRC and ERC disabled, so the demo runs without `kicad-cli`.

## What the broken board reports

| Rule | Severity | Problem |
| --- | --- | --- |
| `design.board-outline` | high | The `Edge.Cuts` outline is open. |
| `design.unique-references` | high | A reference designator (`R1`) is used twice. |
| `bom.missing-mpn` | high | A populated BOM row has no manufacturer part number. |
| `bom.compliance` | high | A populated part is marked `Non-Compliant`. |

The `fixed` board resolves all four and reports nothing. Each problem maps to one clear cause and one clear fix, documented in the [demo README](https://github.com/oaslananka/boardreadyops/tree/main/examples/golden-demo#expected-findings).

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
