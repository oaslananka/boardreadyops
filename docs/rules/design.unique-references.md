---
id: design.unique-references
severity-default: high
applies-to:
  - pcb
config-keys:
  - rules.design.unique-references.enabled
  - rules.design.unique-references.ignore-refs
---

# design.unique-references

## What It Checks

Flags board footprints that share a reference designator.

## When It Fires

Fires when the rule is enabled and a reference designator is used by more than one footprint.

## Configuration Example

```yaml
version: 1
rules:
  design.unique-references:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ reference, count }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
