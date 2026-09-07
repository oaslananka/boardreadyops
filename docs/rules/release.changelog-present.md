---
id: release.changelog-present
severity-default: medium
applies-to:
  - manifest
config-keys:
  - rules.release.changelog-present.enabled
---

# release.changelog-present

## What It Checks

Checks CHANGELOG.md for an entry matching the board revision.

## When It Fires

Fires when CHANGELOG.md is missing or lacks the current revision entry.

## Configuration Example

```yaml
version: 1
rules:
  release.changelog-present:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ revision }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
