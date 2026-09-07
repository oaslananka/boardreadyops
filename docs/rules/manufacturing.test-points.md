---
id: manufacturing.test-points
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.test-points.enabled
  - rules.manufacturing.test-points.minimum
---

# manufacturing.test-points

## What It Checks

Checks for a configured minimum number of test point footprints for in-circuit or functional test.

## When It Fires

Fires when the parsed PCB has fewer test point references than the configured minimum.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.test-points:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ required, found }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
