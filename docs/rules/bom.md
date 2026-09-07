# Bom Rules

- [bom.compliance](bom.compliance.md): Checks populated BOM components for RoHS/REACH compliance metadata. Runs only when explicitly enabled.
- [bom.dnp-consistency](bom.dnp-consistency.md): Compares BOM do-not-populate flags with PCB footprint population attributes.
- [bom.eol-detection](bom.eol-detection.md): Checks lifecycle-style BOM fields for end-of-life and not-recommended markers.
- [bom.footprint-mismatch](bom.footprint-mismatch.md): Compares normalized BOM footprint values with PCB footprint assignments.
- [bom.identity-conflicts](bom.identity-conflicts.md): Detects components whose identity fields (MPN, manufacturer) differ between BOM and schematic sources, or appear multiple times within the same BOM with conflicting values.
- [bom.lifecycle](bom.lifecycle.md): Checks BOM lifecycle fields and local lifecycle data for risky component states.
- [bom.missing-mpn](bom.missing-mpn.md): Checks populated BOM and schematic rows for missing manufacturer part numbers.
- [bom.risk-score](bom.risk-score.md): Scores each populated BOM row on missing MPN, missing manufacturer, no suppliers, and single-source-without-alternates signals. Emits a finding per at-risk component so release readiness reflects aggregate BOM supply-chain quality.
- [bom.single-source](bom.single-source.md): Checks supplier metadata for BOM rows that only list one source.
- [bom.unknown-lifecycle](bom.unknown-lifecycle.md): Flags components that have no lifecycle data from any source (BOM field, lifecycle database, or supplier plugin). Unknown lifecycle status is not silently treated as safe — the absence of data is itself a supply-chain signal.
- [bom.variant-consistency](bom.variant-consistency.md): Checks KiCad variant DNP overrides against each variant-specific BOM.
