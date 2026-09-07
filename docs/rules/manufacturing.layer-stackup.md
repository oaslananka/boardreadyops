---
id: manufacturing.layer-stackup
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.layer-stackup.expected-layers
---

# manufacturing.layer-stackup

## What It Checks

Compares the parsed PCB stackup layer count with configured expectations.

## When It Fires

Fires when the stackup block contains a different copper layer count than expected.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.layer-stackup:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ expectedLayers, stackupLayers }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
