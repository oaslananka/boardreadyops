---
id: pinmap.collision
severity-default: high
applies-to:
  - pinmap
config-keys:
  - pinmap
  - projects.pinmap
---

# pinmap.collision

## What It Checks

Checks pinmap files for duplicate pin and net assignments.

## When It Fires

Fires when a pin key or net key appears more than once.

## Configuration Example

```yaml
version: 1
rules:
  pinmap.collision:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ key, kind }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
