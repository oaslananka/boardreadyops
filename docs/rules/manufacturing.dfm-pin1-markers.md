---
id: manufacturing.dfm-pin1-markers
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-pin1-markers
---

# manufacturing.dfm-pin1-markers

## What It Checks

Checks that ICs and polarised connectors use recognized library footprints that include standard pin-1 markers.

## When It Fires

Fires for each IC or polarised connector whose footprint is not a recognized library footprint carrying a standard pin-1 marker.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.dfm-pin1-markers:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ reference, footprint }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
