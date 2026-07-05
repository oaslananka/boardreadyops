---
id: bom.single-source
severity-default: medium
applies-to:
  - bom
config-keys:
  - rules.bom.single-source.enabled
  - rules.bom.single-source.severity
  - bom.alternates
---

# bom.single-source

## What It Checks

Checks supplier columns for parts that only list one source.

## When It Fires

Fires when supplier metadata is present and a row has a single supplier and no approved alternates are configured for its MPN.

## Configuration Example

```yaml
version: 1
rules:
  bom.single-source:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ reference, mpn, supplier }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
