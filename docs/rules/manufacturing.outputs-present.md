---
id: manufacturing.outputs-present
severity-default: high
applies-to:
  - pcb
  - manifest
config-keys:
  - rules.manufacturing.outputs-present.required
  - rules.manufacturing.outputs-present.patterns
---

# manufacturing.outputs-present

## What It Checks

Checks required fabrication outputs and whether they are fresh relative to PCB sources.

## When It Fires

Fires when a configured or vendor-profile required output is missing or older than the PCB.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.outputs-present:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ required, vendorProfile?, vendorAssumptions? }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
