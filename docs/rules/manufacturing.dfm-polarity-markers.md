---
id: manufacturing.dfm-polarity-markers
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-polarity-markers
---

# manufacturing.dfm-polarity-markers

## What It Checks

Checks that polarized components (diodes, LEDs, electrolytic capacitors) use recognized library footprints that include standard polarity markings.

## When It Fires

Fires for each polarized component -- diode, LED, or electrolytic capacitor -- whose footprint is not a recognized library footprint carrying a standard polarity marking.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.dfm-polarity-markers:
    enabled: true
    severity: low
```

## JSON Finding Details Shape

```text
{ reference, footprint }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
