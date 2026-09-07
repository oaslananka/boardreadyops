---
id: manufacturing.dfm-silkscreen-over-pad
severity-default: info
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-silkscreen-over-pad.minimum-smd-count
---

# manufacturing.dfm-silkscreen-over-pad

## What It Checks

Flags boards with a high density of SMD components as a reminder to verify that silkscreen markings do not overlap solder pads.

## When It Fires

Fires once per board when the SMD component count reaches the configured density threshold, as a reminder to enable KiCad DRC silkscreen clearance for production.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: true
    severity: info
```

## JSON Finding Details Shape

```text
{ smdCount, minimumSmdCount }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
