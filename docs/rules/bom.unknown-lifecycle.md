---
id: bom.unknown-lifecycle
severity-default: info
applies-to:
  - bom
config-keys:
  - rules.bom.unknown-lifecycle.enabled
  - rules.bom.unknown-lifecycle.severity
  - rules.bom.unknown-lifecycle.db
---

# bom.unknown-lifecycle

## What It Checks

Flags BOM components that have no lifecycle data from any source: no BOM `Lifecycle` column, no entry in a local lifecycle JSON database, and no supplier plugin providing a status.

## Why Unknown Is Not Safe

Many teams assume a missing lifecycle field means the part is `active`. That assumption silently hides sourcing risk. This rule makes the gap explicit so reviewers can make an informed decision rather than an accidental one.

## When It Fires

Fires for every populated (non-DNP) component that lacks lifecycle data in all available sources.

## Configuration

```yaml
version: 1
rules:
  bom.unknown-lifecycle:
    enabled: true
    severity: info        # info | low | medium | high
    db: lifecycle.json    # optional: same JSON database as bom.lifecycle
```

## Using a Lifecycle Database

The `db` key points to a project-local JSON file mapping MPN to lifecycle status. Components present in the database are not flagged, regardless of whether the status is `Active`, `NRND`, or `EOL`.

```json
{
  "MCU-1": "Active",
  "SENSOR-X": "NRND"
}
```

## JSON Finding Details Shape

```text
{ reference, mpn }
```

## Lifecycle Status Model

BoardReadyOps maps raw lifecycle strings to a typed canonical set:

| Canonical   | Matched patterns                                      | Risk level |
|-------------|-------------------------------------------------------|------------|
| `active`    | Active, In Production, Production                     | none       |
| `nrnd`      | NRND, Not Recommended, Preview, Engineering Sample    | medium     |
| `eol`       | EOL, End Of Life, End-of-Life                         | high       |
| `obsolete`  | Obsolete, Discontinued                                | critical   |
| `unknown`   | (no data found)                                       | info       |
| `custom`    | anything not matching the above                       | info       |

## Relationship With Other Rules

- `bom.lifecycle` flags components with *known risky* lifecycle statuses (EOL, NRND, discontinued).
- `bom.eol-detection` specifically flags EOL markers in BOM columns.
- `bom.unknown-lifecycle` fills the gap by flagging components where the lifecycle status is absent — a different and complementary signal.

## Data Sources (Trusted vs Untrusted)

| Source            | Trust level | Notes                                          |
|-------------------|-------------|------------------------------------------------|
| BOM field         | Moderate    | Self-reported by the designer; may be stale    |
| Lifecycle DB      | Moderate    | Curated per-project; must be maintained        |
| Supplier plugin   | Higher      | Live data from distributor APIs; time-bounded  |
| Manual config     | High        | Explicitly reviewed and committed              |

Prefer supplier plugins or curated local databases over raw BOM fields for components on the critical path.
