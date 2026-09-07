---
id: manufacturing.tooling-holes
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.tooling-holes.minimum
---

# manufacturing.tooling-holes

## What It Checks

Checks configured fabrication/assembly jobs for a minimum number of tooling or mounting holes.

## When It Fires

Fires when the parsed PCB has fewer tooling-hole candidates than the configured minimum.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.tooling-holes:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ required, found }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
