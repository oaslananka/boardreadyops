---
id: manufacturing.dfm-silkscreen-over-pad
severity-default: info
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-silkscreen-over-pad.enabled
  - rules.manufacturing.dfm-silkscreen-over-pad.minimum-smd-count
---

# manufacturing.dfm-silkscreen-over-pad

**Opt-in** · Severity: `info`

## What It Checks

Counts the number of assembled SMD components on each KiCad PCB and fires a reminder finding when the count reaches or exceeds `minimum-smd-count`.  The finding is a prompt to run KiCad DRC with the *Silkscreen clipped by solder mask* and *Silkscreen on solder mask* rules enabled before generating Gerbers.

SMD components are identified by footprint-name pattern: `smd`, `0201`, `0402`, `0603`, `0805`, `1206`, `SOT-23`, `SOIC`, `QFP`, `QFN`, `BGA`, `TSSOP`, `SSOP`, `MSOP` (case-insensitive).

## When It Fires

A single finding per PCB is produced when both conditions are met:

1. The rule is explicitly enabled in configuration.
2. The number of assembled (non-DNP, non-board-only) SMD footprints is ≥ `minimum-smd-count` (default: `10`).

## Configuration Example

```yaml
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: true              # required; rule does not run unless explicitly enabled
    minimum-smd-count: 10      # optional; default is 10
```

To lower the threshold for denser or more critical boards:

```yaml
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: true
    minimum-smd-count: 5
    severity: warning
```

## JSON Finding Details Shape

```json
{
  "smdCount": 47,
  "minimumSmdCount": 10
}
```

| Field            | Type   | Description                                             |
|------------------|--------|---------------------------------------------------------|
| `smdCount`       | number | Number of assembled SMD components found on the board  |
| `minimumSmdCount`| number | Configured threshold that triggered the finding         |

## Report Context

Findings appear in the **manufacturing** section of all report formats.  Fix guidance recommends enabling the KiCad DRC silkscreen clearance checks and adjusting component courtyard and silkscreen layers to clear pad areas before submitting Gerbers to a fabrication house.
