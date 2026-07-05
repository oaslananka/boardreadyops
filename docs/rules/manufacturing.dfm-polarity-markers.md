---
id: manufacturing.dfm-polarity-markers
severity-default: low
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.dfm-polarity-markers.enabled
---

# manufacturing.dfm-polarity-markers

**Opt-in** · Severity: `low`

## What It Checks

Scans every footprint in each KiCad PCB file for **polarised components** that use a custom (non-library) footprint.  Polarised components identified by this rule are:

- Diodes and LEDs (`D`, `LED`, `VD` reference prefixes)
- Electrolytic and tantalum capacitors (`C` prefix with a footprint name matching `cp_elec`, `tantalum`, `tant`, `pol_cap`, or the KiCad library paths `Capacitor_THT:CP_` / `Capacitor_SMD:CP_`)

Standard KiCad library footprints (names containing `:`) are exempt because they include polarity markings by convention (bar, stripe, `+` symbol, or cathode marker).

## When It Fires

A finding is produced for each polarised component footprint where:

1. The reference or footprint name pattern matches a known polarised component type.
2. The footprint name does **not** contain a colon (`:`) — indicating a custom, non-library footprint.

DNP (`dnp`) and board-only (`board_only`) components are not evaluated.

## Configuration Example

```yaml
rules:
  manufacturing.dfm-polarity-markers:
    enabled: true        # required; rule does not run unless explicitly enabled
```

To override severity:

```yaml
rules:
  manufacturing.dfm-polarity-markers:
    enabled: true
    severity: warning
```

## JSON Finding Details Shape

```json
{
  "reference": "D3",
  "footprint": "custom_schottky"
}
```

| Field       | Type   | Description                                       |
|-------------|--------|---------------------------------------------------|
| `reference` | string | Reference designator of the flagged component     |
| `footprint` | string | Footprint name (or empty string for unnamed ones) |

## Report Context

Findings appear in the **manufacturing** section of all report formats.  Fix guidance encourages either replacing the footprint with a standard KiCad library footprint that includes a polarity marker, or manually verifying that the silkscreen and fab layers contain an unambiguous polarity indicator before ordering.
