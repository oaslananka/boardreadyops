---
id: manufacturing.board-edge-clearance
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.board-edge-clearance.enabled
  - rules.manufacturing.board-edge-clearance.min-clearance-mm
---

# manufacturing.board-edge-clearance

## What It Checks

Checks that copper features in the Gerber package maintain the required minimum clearance from the board edge.

## When It Fires

Fires when copper features in the Gerber artwork are closer to the board outline than the required minimum edge clearance.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.board-edge-clearance:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ measuredClearanceMm, minClearanceMm, confidence, layer, profileRevision }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
