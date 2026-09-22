---
id: manufacturing.paste-coverage
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.paste-coverage.enabled
---

# manufacturing.paste-coverage

## What It Checks

Checks that each side with SMT components in the Gerber package has a matching solder paste layer.

## When It Fires

Fires when the board has SMT components on an outer side but the Gerber package lacks a solder paste stencil layer for that side. Through-hole components and DNP footprints do not require paste.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.paste-coverage:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ side, pasteLayers }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
