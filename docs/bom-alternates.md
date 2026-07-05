# BOM Approved Alternates

The `bom.alternates` configuration key lets teams document approved substitute
parts for a primary MPN so that supply-chain risk checks can distinguish an
actively managed single-source decision from an oversight.

## Why Use Alternates?

The [`bom.single-source`](../rules/bom.single-source.md) rule flags BOM rows
where only one supplier is listed — a signal that availability risk has not been
addressed.  When a team has already validated a drop-in replacement but chooses
to order only from the primary supplier, the `bom.alternates` list documents
that decision and silences the finding.

## Configuration Format

Add a `bom.alternates` list to `boardreadyops.yml`.  Each entry identifies a
**primary MPN** and one or more **approved alternates**.

```yaml
bom:
  alternates:
    - mpn: "RC0603FR-0710KL"
      alts:
        - mpn: "RMCF0603FT10K0"
          manufacturer: "Stackpole Electronics"
          note: "Verified drop-in replacement — same footprint and rating"
    - mpn: "LMR33640ADDA"
      alts:
        - mpn: "MP2359DJ"
          manufacturer: "Monolithic Power"
          note: "Tested at Rev1 prototype; requires layout review at >500mA"
        - mpn: "TPS62172DSGR"
          manufacturer: "Texas Instruments"
          note: "Pin-compatible if C_out ≥ 10µF"
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `mpn` (top-level) | ✅ | Primary MPN in the BOM that this entry covers |
| `alts[].mpn` | ✅ | Approved substitute MPN |
| `alts[].manufacturer` | ✗ | Manufacturer of the substitute (informational) |
| `alts[].note` | ✗ | Free-form note, e.g. test result, footprint caveat |

MPN matching is **case-insensitive** and trims leading/trailing whitespace.

## Behaviour

When `bom.single-source` encounters a BOM row whose MPN matches a `bom.alternates`
entry (regardless of how many supplier columns are populated), the finding is
suppressed.  The alternates list is visible in the config file and therefore
auditable via version control.

## Example — Prototype vs. Production Workflow

During **prototype**, a team may source only from one supplier.  Adding the
validated alternate to `bom.alternates` documents the decision for future
reviewers without blocking the prototype build.

For **production**, sourcing teams can use the alternates list to onboard a
second supplier, at which point the BOM will show two supplier columns and
`bom.single-source` will no longer fire — regardless of whether the MPN is in
the alternates list.

## Alternates and the Evidence Bundle

Alternates metadata is visible in the boardreadyops YAML config, which is
included in the release evidence bundle.  Reports and PR comments will
reference the `bom.alternates` config key in any finding that was suppressed
because of it.
