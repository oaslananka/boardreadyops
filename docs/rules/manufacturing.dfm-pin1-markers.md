---
id: manufacturing.dfm-pin1-markers
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-pin1-markers.enabled
---

# manufacturing.dfm-pin1-markers

**Opt-in** · Severity: `low`

## What It Checks

Scans every footprint in each KiCad PCB file for ICs and polarised connectors that use a **custom (non-library) footprint** — that is, a footprint whose name does not contain the `Library:FootprintName` colon-separated format used by KiCad's built-in libraries.

Affected reference designator prefixes: `U`, `IC` (ICs), `J`, `P`, `CN`, `X` (connectors).

Standard KiCad library footprints are exempt because they include pin-1 markers by convention (dot, triangle, chamfer, or silk-screen arrow).

## When It Fires

A finding is produced for each IC or connector footprint that satisfies both conditions:

1. The reference designator starts with a prefix associated with a multi-pin, polarised component (`U`, `IC`, `J`, `P`, `CN`, `X`).
2. The footprint name does **not** contain a colon (`:`) — i.e., it is not a recognised KiCad library footprint.

DNP (`dnp`) and board-only (`board_only`) components are ignored.

## Configuration Example

```yaml
rules:
  manufacturing.dfm-pin1-markers:
    enabled: true        # required; rule does not run unless explicitly enabled
```

To override severity:

```yaml
rules:
  manufacturing.dfm-pin1-markers:
    enabled: true
    severity: warning
```

## JSON Finding Details Shape

```json
{
  "reference": "U3",
  "footprint": "custom_attiny"
}
```

| Field       | Type   | Description                                       |
|-------------|--------|---------------------------------------------------|
| `reference` | string | Reference designator of the flagged component     |
| `footprint` | string | Footprint name (or empty string for unnamed ones) |

## Report Context

Findings appear in the **manufacturing** section of all report formats.  Fix guidance encourages either replacing the footprint with a standard KiCad library footprint that includes a pin-1 marker, or manually adding an unambiguous pin-1 indicator to the silkscreen or fab layer before ordering.
