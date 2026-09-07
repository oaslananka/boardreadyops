---
id: manufacturing.assembly-sides
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.assembly-sides.enabled
  - rules.manufacturing.assembly-sides.allow-bottom-side
---

# manufacturing.assembly-sides

## What It Checks

Reports assembly components placed on the bottom copper layer.

## When It Fires

Fires when assembly components are on the bottom side and bottom-side placement is not allowed.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.assembly-sides:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ bottomSideCount, references }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
