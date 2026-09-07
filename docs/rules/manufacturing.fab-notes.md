---
id: manufacturing.fab-notes
severity-default: medium
applies-to:
  - manifest
config-keys:
  - rules.manufacturing.fab-notes.enabled
---

# manufacturing.fab-notes

## What It Checks

Checks known project paths for fabrication notes that travel with board outputs.

## When It Fires

Fires when no fabrication notes file is present.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.fab-notes:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ expectedPaths }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
