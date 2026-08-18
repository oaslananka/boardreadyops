# KiBot Integration

KiBot and BoardReadyOps solve different parts of the hardware release flow. KiBot is best used as the artifact generator and automation engine. BoardReadyOps is best used as the release-readiness, evidence, and policy gate that validates generated outputs before a PCB is sent to manufacturing.

## Recommended Split

| Concern | KiBot | BoardReadyOps |
| --- | --- | --- |
| Generate Gerbers, drills, PDFs, BOMs, CPL/position files, and assembly artifacts | Yes | No |
| Run KiCad-oriented output automation and variants | Yes | Consumes and validates results |
| Check that manufacturing outputs are present and project-aligned | Produces inputs | Yes |
| Apply release gates, suppressions, baselines, and risk policy | No | Yes |
| Emit SARIF/JUnit/HTML/Markdown/JSON evidence for CI decisions | Partial, depending on setup | Yes |
| Produce a release evidence bundle and verify checksums | No | Yes |

## CI Pattern

Run KiBot first, store its output in a deterministic directory, then run BoardReadyOps against the same repository and generated artifacts.

```yaml
jobs:
  hardware-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Generate fabrication outputs with KiBot
        run: kibot -c kibot.yaml -b hardware/main.kicad_pcb -d build/fab

      - name: Validate release readiness
        uses: oaslananka/boardreadyops@9ff52b175961d1c144a8fd99ba1a8d4528fb01c8 # v1.31.1
        with:
          config: boardreadyops.yml
          mode: enforce
          fail-on: high
```

A typical `boardreadyops.yml` keeps generated paths explicit so CI results are reproducible.

```yaml
version: 1
mode: enforce
fail-on: high
vendor:
  profile: jlcpcb
projects:
  - path: hardware/main.kicad_pro
    outputs:
      gerbers: build/fab/gerbers
      drills: build/fab/drill
      bom: build/fab/bom.csv
      cpl: build/fab/positions.csv
```

## Release Evidence Flow

A mature pipeline should produce a traceable decision record:

1. Generate outputs with KiBot or `kicad-cli`.
2. Run BoardReadyOps checks with the selected vendor profile and release gate.
3. Review findings, suppressions, and waivers.
4. Produce a release evidence bundle with `boardreadyops release pack`.
5. Verify the bundle with `boardreadyops release verify` before handing artifacts to manufacturing.

## What BoardReadyOps Does Not Claim

BoardReadyOps does not replace a DFM review from a board house, an electrical design review, or KiBot output generation. It reduces release risk by making the evidence visible, repeatable, and enforceable in CI.
