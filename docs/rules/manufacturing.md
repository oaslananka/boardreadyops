# Manufacturing Rules

- [manufacturing.assembly-sides](manufacturing.assembly-sides.md): Reports assembly components placed on the bottom copper layer.
- [manufacturing.board-edge-clearance](manufacturing.board-edge-clearance.md): Checks that copper features in the Gerber package maintain the required minimum clearance from the board edge.
- [manufacturing.dfm-pin1-markers](manufacturing.dfm-pin1-markers.md): Checks that ICs and polarised connectors use recognized library footprints that include standard pin-1 markers.
- [manufacturing.dfm-polarity-markers](manufacturing.dfm-polarity-markers.md): Checks that polarized components (diodes, LEDs, electrolytic capacitors) use recognized library footprints that include standard polarity markings.
- [manufacturing.dfm-silkscreen-over-pad](manufacturing.dfm-silkscreen-over-pad.md): Flags boards with a high density of SMD components as a reminder to verify that silkscreen markings do not overlap solder pads.
- [manufacturing.drill-coverage](manufacturing.drill-coverage.md): Compares PCB drill sizes with the tool diameters declared in the Excellon outputs.
- [manufacturing.fab-notes](manufacturing.fab-notes.md): Checks known project paths for fabrication notes that travel with board outputs.
- [manufacturing.fiducials](manufacturing.fiducials.md): Checks configured assembly jobs for a minimum number of fiducial footprints.
- [manufacturing.jobset-outputs](manufacturing.jobset-outputs.md): Checks enabled KiCad jobset entries for their expected output files.
- [manufacturing.layer-stackup](manufacturing.layer-stackup.md): Compares the parsed PCB stackup layer count with configured expectations.
- [manufacturing.mask-coverage](manufacturing.mask-coverage.md): Checks that each outer copper side in the Gerber package has a matching solder mask layer.
- [manufacturing.outputs-present](manufacturing.outputs-present.md): Checks required fabrication outputs and whether they are fresh relative to PCB sources.
- [manufacturing.package-completeness](manufacturing.package-completeness.md): Validates that the release package includes all required manufacturing output categories. Base categories (gerbers, drill, BOM, CPL) are required for every release. Production categories (fab notes, assembly notes, board PDF) are required when releaseMode is production.
- [manufacturing.panel-sanity](manufacturing.panel-sanity.md): Checks panelized manufacturing configurations for panel output files.
- [manufacturing.paste-coverage](manufacturing.paste-coverage.md): Checks that each side with SMT components in the Gerber package has a matching solder paste layer.
- [manufacturing.position-coverage](manufacturing.position-coverage.md): Checks configured assembly jobs for position/CPL output coverage of populated PCB references.
- [manufacturing.test-points](manufacturing.test-points.md): Checks for a configured minimum number of test point footprints for in-circuit or functional test.
- [manufacturing.tooling-holes](manufacturing.tooling-holes.md): Checks configured fabrication/assembly jobs for a minimum number of tooling or mounting holes.
