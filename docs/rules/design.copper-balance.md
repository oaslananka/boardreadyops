---
id: design.copper-balance
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.design.copper-balance.min-coverage-percent
---

# design.copper-balance

## What It Checks

Checks filled copper coverage on PCB layers against the configured minimum.

## When It Fires

Fires when a copper layer is below the configured minimum coverage percentage.

## Configuration Example

```yaml
version: 1
rules:
  design.copper-balance:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ layer, coveragePercent, minimum }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
