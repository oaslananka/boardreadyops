# Manufacturing Rules

- [manufacturing.outputs-present](manufacturing.outputs-present.md): Checks configured and vendor-profile fabrication output patterns and freshness against PCB source mtimes.
- [manufacturing.jobset-outputs](manufacturing.jobset-outputs.md): Checks enabled KiCad 10 jobset entries for their expected output files.
- [manufacturing.panel-sanity](manufacturing.panel-sanity.md): Checks that panelized builds include expected panel output files.
- [manufacturing.fab-notes](manufacturing.fab-notes.md): Checks for fabrication notes in known project paths.
- [manufacturing.drill-coverage](manufacturing.drill-coverage.md): Checks parsed PCB drill sizes against generated Excellon drill files.
- [manufacturing.layer-stackup](manufacturing.layer-stackup.md): Checks KiCad PCB stackup layer count against expected copper layers.
- [manufacturing.fiducials](manufacturing.fiducials.md): Checks explicitly enabled assembly jobs for minimum fiducial footprint coverage.
- [manufacturing.test-points](manufacturing.test-points.md): Checks explicitly enabled assembly jobs for minimum test point footprint coverage.
- [manufacturing.assembly-sides](manufacturing.assembly-sides.md): Checks explicitly enabled assembly jobs for components placed on the bottom copper layer.
- [manufacturing.tooling-holes](manufacturing.tooling-holes.md): Checks explicitly enabled manufacturing jobs for minimum tooling or mounting hole coverage.
- [manufacturing.position-coverage](manufacturing.position-coverage.md): Checks explicitly enabled assembly jobs for populated reference coverage in position/CPL outputs.
- [manufacturing.dfm-pin1-markers](manufacturing.dfm-pin1-markers.md): Checks ICs and polarised connectors with custom footprints for missing pin-1 markers.
- [manufacturing.dfm-polarity-markers](manufacturing.dfm-polarity-markers.md): Checks polarised components (diodes, LEDs, electrolytic capacitors) with custom footprints for missing polarity markings.
- [manufacturing.dfm-silkscreen-over-pad](manufacturing.dfm-silkscreen-over-pad.md): Flags dense SMD boards as a reminder to verify silkscreen markings do not overlap solder pads.
