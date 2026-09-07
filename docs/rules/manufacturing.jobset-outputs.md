---
id: manufacturing.jobset-outputs
severity-default: medium
applies-to:
  - manifest
config-keys:
  - rules.manufacturing.jobset-outputs.enabled
---

# manufacturing.jobset-outputs

## What It Checks

Checks enabled KiCad jobset entries for their expected output files.

## When It Fires

Fires when an enabled jobset output path does not exist.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.jobset-outputs:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ type, outputPath }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
