---
id: bom.risk-score
severity-default: medium
applies-to:
  - bom
config-keys:
  - rules.bom.risk-score.enabled
  - rules.bom.risk-score.severity
  - rules.bom.risk-score.critical-severity
  - rules.bom.risk-score.high-severity
  - rules.bom.risk-score.medium-severity
  - rules.bom.risk-score.low-severity
  - rules.bom.risk-score.weights.missing-mpn
  - rules.bom.risk-score.weights.missing-manufacturer
  - rules.bom.risk-score.weights.no-suppliers
  - rules.bom.risk-score.weights.single-source-no-alternates
  - bom.alternates
---

# bom.risk-score

## What It Checks

Scores each populated BOM row on missing MPN, missing manufacturer, no suppliers, and single-source-without-alternates signals.

## When It Fires

Fires for each non-DNP row with a non-zero risk score. Severity is mapped from the component risk level (critical/high/medium/low) and is configurable per level.

## Configuration Example

```yaml
version: 1
rules:
  bom.risk-score:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ reference, mpn, manufacturer, riskScore, riskLevel, factors: { missingMpn, missingManufacturer, noSuppliers, singleSourceNoAlternates }, overallBomRiskScore, totalComponents }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
