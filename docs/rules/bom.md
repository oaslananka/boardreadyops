# Bom Rules

- [bom.missing-mpn](bom.missing-mpn.md): Checks normalized BOM rows for missing manufacturer part numbers.
- [bom.single-source](bom.single-source.md): Checks supplier columns for parts that only list one source.
- [bom.identity-conflicts](bom.identity-conflicts.md): Checks for components whose identity fields (MPN, manufacturer) differ between BOM and schematic sources, or appear multiple times within the same BOM with conflicting values.
- [bom.risk-score](bom.risk-score.md): Scores each populated BOM row on missing MPN, missing manufacturer, no suppliers, and single-source-without-alternates signals.
- [bom.eol-detection](bom.eol-detection.md): Checks lifecycle-style columns for local end-of-life markers.
- [bom.lifecycle](bom.lifecycle.md): Checks BOM lifecycle columns or a local lifecycle database for EOL, NRND, preview, and discontinued markers.
- [bom.footprint-mismatch](bom.footprint-mismatch.md): Compares normalized BOM footprint strings with PCB footprint assignments.
- [bom.dnp-consistency](bom.dnp-consistency.md): Compares BOM DNP flags with PCB footprint population attributes.
- [bom.variant-consistency](bom.variant-consistency.md): Checks KiCad 10 variant DNP overrides against each variant-specific BOM.
- [bom.compliance](bom.compliance.md): Checks populated BOM components for RoHS/REACH compliance metadata when explicitly enabled.
