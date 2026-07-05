# Demo Scenario: Production Ready

This scenario shows a board in `production` release mode with an active supply-chain waiver.

## What this demonstrates

- Production mode (`releaseMode: production`) applied to the project
- An active waiver for `bom.single-source` on U3 (Flash memory) with owner, reason, and expiry
- All BOM components fully documented with MPN, manufacturer, compliance, and lifecycle
- Changelog present and revision set (`v2.0`)
- Passing status despite non-blocking advisory findings

## Run it

```bash
boardreadyops run examples/scenarios/production-ready
```

Exits `0`. The waiver for the single-source component is active and not expired.

## Expected findings

| Rule | Severity | Problem |
|------|----------|---------|
| `manufacturing.fab-notes` | medium | No fab notes layer (advisory) |
| `bom.single-source` | — | Waived — U3 is single-sourced with documented mitigation |

## Waiver

The `boardreadyops.yml` contains a formal waiver for `bom.single-source` covering U3 (Winbond W25Q128JVSIQ). This pattern is what production hardware reviews look like in practice: risk is acknowledged, documented, and time-bounded rather than silently ignored.

## Why this matters

A production-ready scenario shows that BoardReadyOps handles real-world complexity — not just failing or trivially passing boards. Procurement and hardware review teams can share the `report.json` as an audit trail.
