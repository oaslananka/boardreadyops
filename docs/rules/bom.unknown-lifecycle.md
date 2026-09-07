---
id: bom.unknown-lifecycle
severity-default: info
applies-to:
  - bom
config-keys:
  - rules.bom.unknown-lifecycle.severity
  - rules.bom.unknown-lifecycle.db
---

# bom.unknown-lifecycle

## What It Checks

Flags components that have no lifecycle data from any source (BOM field, lifecycle database, or supplier plugin). Unknown lifecycle status is not silently treated as safe — the absence of data is itself a supply-chain signal.

## When It Fires

Fires for each populated BOM row whose lifecycle status cannot be resolved from the BOM field, the lifecycle cache, or a supplier plugin.

## Configuration Example

```yaml
version: 1
rules:
  bom.unknown-lifecycle:
    enabled: true
    severity: info
```

## JSON Finding Details Shape

```text
{ reference, mpn, manufacturer }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
