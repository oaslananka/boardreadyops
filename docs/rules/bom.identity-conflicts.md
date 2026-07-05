---
id: bom.identity-conflicts
severity-default: high
applies-to:
  - bom
  - schematic
config-keys:
  - rules.bom.identity-conflicts.enabled
  - rules.bom.identity-conflicts.severity
---

# bom.identity-conflicts

## What It Checks

Checks for components whose identity fields (MPN, manufacturer) differ between BOM and schematic sources, or appear multiple times within the same BOM with conflicting values.

## When It Fires

Fires when the same reference designator has inconsistent MPNs across sources. Covers both within-BOM duplicate rows and BOM-vs-schematic conflicts.

## Configuration Example

```yaml
version: 1
rules:
  bom.identity-conflicts:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ reference, conflictType, mpns } or { reference, conflictType, bomMpn, schematicMpn }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
