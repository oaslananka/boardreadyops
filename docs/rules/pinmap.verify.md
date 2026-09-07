---
id: pinmap.verify
severity-default: high
applies-to:
  - pinmap
  - schematic
config-keys:
  - pinmap
  - projects.pinmap
---

# pinmap.verify

## What It Checks

Checks configured pinmap nets against parsed schematic net labels.

## When It Fires

Fires when a pinmap entry points at a net not present in the schematic.

## Configuration Example

```yaml
version: 1
rules:
  pinmap.verify:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ entry }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
