---
id: release.revision-set
severity-default: high
applies-to:
  - pcb
config-keys:
  - rules.release.revision-set.enabled
---

# release.revision-set

## What It Checks

Checks PCB title-block revisions against the configured release tag pattern.

## When It Fires

Fires when revision is empty or does not match the configured pattern.

## Configuration Example

```yaml
version: 1
rules:
  release.revision-set:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ revision, tagPattern }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
