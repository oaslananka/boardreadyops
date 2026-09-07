---
id: bom.footprint-mismatch
severity-default: medium
applies-to:
  - bom
  - pcb
config-keys:
  - rules.bom.footprint-mismatch.severity
---

# bom.footprint-mismatch

## What It Checks

Compares normalized BOM footprint values with PCB footprint assignments.

## When It Fires

Fires when a reference appears in both sources with different footprints.

## Configuration Example

```yaml
version: 1
rules:
  bom.footprint-mismatch:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ reference, bomFootprint, pcbFootprint }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
