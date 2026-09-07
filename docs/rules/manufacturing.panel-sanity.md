---
id: manufacturing.panel-sanity
severity-default: medium
applies-to:
  - manifest
config-keys:
  - rules.manufacturing.panel-sanity.panelized
---

# manufacturing.panel-sanity

## What It Checks

Checks panelized manufacturing configurations for panel output files.

## When It Fires

Fires when panelization is enabled but no panel output is present.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.panel-sanity:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ panelized }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
