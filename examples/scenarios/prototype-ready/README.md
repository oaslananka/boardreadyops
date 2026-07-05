# Demo Scenario: Prototype Ready

This scenario shows a clean prototype-stage board that passes all enabled checks.

## What this demonstrates

- All BOM components have MPN, manufacturer, compliance, and lifecycle data
- No supply-chain flags or risk findings
- `bom.risk-score` produces a low risk summary
- Non-blocking advisory findings (`manufacturing.fab-notes`) don't block the prototype

## Run it

```bash
boardreadyops run examples/scenarios/prototype-ready
```

Exits `0`. All high and critical findings are resolved.

## Expected findings

| Rule | Severity | Problem |
|------|----------|---------|
| `manufacturing.fab-notes` | medium | No fab notes layer (informational only) |

## Why this matters

A prototype-ready board demonstrates that BoardReadyOps passes clean designs without false positives. The medium finding from `manufacturing.fab-notes` is advisory — important for production but not required for prototype builds.
