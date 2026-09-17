---
id: manufacturing.paste-coverage
severity-default: high
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.paste-coverage.enabled
---

# manufacturing.paste-coverage

## What It Checks

Checks that each board side containing surface-mount assembly components has a matching solder paste layer in the Gerber package.

## When It Fires

When a board contains surface-mount assembly components on top or bottom but the Gerber package contains no solder paste layer artwork for that side.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.paste-coverage:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ side: "top" | "bottom", smtComponentCount: number, references: string[] }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
