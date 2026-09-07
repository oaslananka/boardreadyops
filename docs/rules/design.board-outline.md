---
id: design.board-outline
severity-default: high
applies-to:
  - pcb
config-keys:
  - rules.design.board-outline.enabled
---

# design.board-outline

## What It Checks

Checks that the PCB Edge.Cuts outline is present and closes into a board boundary.

## When It Fires

Fires when Edge.Cuts segments do not form a closed outline.

## Configuration Example

```yaml
version: 1
rules:
  design.board-outline:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ outlineClosed }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
