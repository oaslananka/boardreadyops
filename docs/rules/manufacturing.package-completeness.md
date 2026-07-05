---
id: manufacturing.package-completeness
severity-default: high
applies-to:
  - manifest
  - pcb
config-keys:
  - rules.manufacturing.package-completeness.severity
---

# manufacturing.package-completeness

## What It Checks

Checks that all required manufacturing output categories are present. Base categories (gerbers, drill, drill-report, BOM, CPL) are required for every release. Production categories (fab-notes, assembly-notes, board-pdf) are additionally required when releaseMode is production.

## When It Fires

Fires for each missing output category with a structured completeness breakdown.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.package-completeness:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ missingCategory, requirementLevel, completenessScore, presentCategories, missingCategories }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
