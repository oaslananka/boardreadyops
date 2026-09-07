---
id: drc.kicad
severity-default: high
applies-to:
  - pcb
config-keys:
  - kicad-cli
  - require-kicad
  - rules.drc
---

# drc.kicad

## What It Checks

Runs KiCad PCB design-rule checks and normalizes their diagnostics into findings.

## When It Fires

Fires for every KiCad DRC diagnostic in the JSON report.

## Configuration Example

```yaml
version: 1
rules:
  drc.kicad:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ source: 'kicad-cli', diagnostic: <KiCad diagnostic object> }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
