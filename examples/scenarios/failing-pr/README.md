# Demo Scenario: Failing PR

This scenario shows a pull request that fails the BoardReadyOps review with multiple blocking findings.

## What this demonstrates

- A component (`U1`) with no Manufacturer Part Number (MPN) — `bom.missing-mpn`
- A component (`U2`) marked as non-compliant — `bom.compliance`
- NRND lifecycle status is present but handled by `bom.lifecycle`
- Overall BOM risk score elevated — `bom.risk-score`

## Run it

```bash
boardreadyops run examples/scenarios/failing-pr
```

This exits `1` with blocking findings. A PR gated on `fail-on: high` would block merging.

## Expected findings

| Rule | Severity | Problem |
|------|----------|---------|
| `bom.missing-mpn` | high | U1 (MCU) has no MPN — cannot be ordered reliably |
| `bom.compliance` | high | U2 (PMIC) is marked Non-Compliant |
| `bom.risk-score` | medium | Overall BOM risk is elevated |
| `bom.eol-detection` | high | U2 lifecycle is NRND |

## Why this matters

Teams running BoardReadyOps as a GitHub Action gate prevent these issues from reaching fabrication. The exact findings in `report.json` are the machine-readable output that appears in PR comments and dashboard views.
