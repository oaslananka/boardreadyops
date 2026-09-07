---
id: bom.dnp-consistency
severity-default: medium
applies-to:
  - bom
  - pcb
config-keys:
  - rules.bom.dnp-consistency.severity
---

# bom.dnp-consistency

## What It Checks

Compares BOM do-not-populate flags with PCB footprint population attributes.

## When It Fires

Fires when BOM and PCB disagree on populated versus DNP state.

## Configuration Example

```yaml
version: 1
rules:
  bom.dnp-consistency:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ reference, bomDnp, pcbDnp }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
