---
id: manufacturing.drill-coverage
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.drill-coverage.enabled
---

# manufacturing.drill-coverage

## What It Checks

Compares PCB drill sizes with generated Excellon drill outputs.

## When It Fires

Fires when a PCB drill size is absent from drill output.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.drill-coverage:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ missingDrills }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
