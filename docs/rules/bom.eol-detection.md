---
id: bom.eol-detection
severity-default: high
applies-to:
  - bom
config-keys:
  - rules.bom.eol-detection.severity
---

# bom.eol-detection

## What It Checks

Checks lifecycle-style BOM fields for end-of-life and not-recommended markers.

## When It Fires

Fires when lifecycle text indicates obsolete, NRND, discontinued, or EOL status.

## Configuration Example

```yaml
version: 1
rules:
  bom.eol-detection:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ reference, mpn, lifecycle }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
