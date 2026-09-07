---
id: bom.compliance
severity-default: high
applies-to:
  - bom
config-keys:
  - rules.bom.compliance.enabled
  - rules.bom.compliance.require
  - rules.bom.compliance.severity
---

# bom.compliance

## What It Checks

Checks populated BOM components for RoHS/REACH compliance metadata. Runs only when explicitly enabled.

## When It Fires

Fires when a populated component is marked non-compliant, or (with require) when it has no compliance data.

## Configuration Example

```yaml
version: 1
rules:
  bom.compliance:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ reference, mpn, compliance? }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
