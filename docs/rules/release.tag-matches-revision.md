---
id: release.tag-matches-revision
severity-default: high
applies-to:
  - pcb
  - manifest
config-keys:
  - GITHUB_REF_NAME
---

# release.tag-matches-revision

## What It Checks

Checks tag CI context against the board revision recorded in PCB metadata.

## When It Fires

Fires when GITHUB_REF_TYPE=tag and GITHUB_REF_NAME does not match the revision.

## Configuration Example

```yaml
version: 1
rules:
  release.tag-matches-revision:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ revision, tag }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
