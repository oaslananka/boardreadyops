---
id: manufacturing.mask-coverage
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.mask-coverage.enabled
---

# manufacturing.mask-coverage

## What It Checks

Checks that each outer copper side in the Gerber package has a matching solder mask layer.

## When It Fires

Fires when the Gerber package has copper on an outer side with no solder mask layer for that side. Inner copper is not checked: mask applies to the outer faces.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.mask-coverage:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ side, copperLayers, maskLayers }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
