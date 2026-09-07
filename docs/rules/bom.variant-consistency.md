---
id: bom.variant-consistency
severity-default: high
applies-to:
  - bom
  - project
config-keys:
  - projects.variants
  - rules.bom.variant-consistency.enabled
---

# bom.variant-consistency

## What It Checks

Checks KiCad variant DNP overrides against each variant-specific BOM.

## When It Fires

Fires when a component disabled by the active variant still appears populated in that variant BOM.

## Configuration Example

```yaml
version: 1
rules:
  bom.variant-consistency:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ variant, reference }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
