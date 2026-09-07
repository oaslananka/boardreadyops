---
id: release.version-format
severity-default: low
applies-to:
  - pcb
  - schematic
config-keys:
  - rules.release.version-format.pattern
---

# release.version-format

## What It Checks

Checks schematic and PCB revisions against the configured release version pattern.

## When It Fires

Fires when a revision does not match vMAJOR.MINOR or rMAJOR.MINOR by default.

## Configuration Example

```yaml
version: 1
rules:
  release.version-format:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ revision, pattern }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
