import { mkdir, writeFile } from "node:fs/promises";

const rules = [
  {
    id: "drc.kicad",
    severity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.drc.kicad.enabled", "rules.drc.severity-overrides"],
    checks: "Runs KiCad PCB DRC and normalizes KiCad diagnostics into BoardReadyOps findings.",
    fires: "Fires for every KiCad DRC diagnostic in the JSON report.",
    details: "{ source: 'kicad-cli', diagnostic: <KiCad diagnostic object> }",
  },
  {
    id: "erc.kicad",
    severity: "high",
    appliesTo: ["schematic"],
    configKeys: ["rules.erc.kicad.enabled", "rules.erc.severity-overrides"],
    checks: "Runs KiCad schematic ERC and normalizes KiCad diagnostics into BoardReadyOps findings.",
    fires: "Fires for every KiCad ERC diagnostic in the JSON report.",
    details: "{ source: 'kicad-cli', diagnostic: <KiCad diagnostic object> }",
  },
  {
    id: "bom.missing-mpn",
    severity: "high",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.missing-mpn.enabled", "rules.bom.missing-mpn.ignore-refs"],
    checks: "Checks normalized BOM rows for missing manufacturer part numbers.",
    fires: "Fires when a populated BOM row has no MPN and the reference is not ignored.",
    details: "{ reference, value, footprint }",
  },
  {
    id: "bom.single-source",
    severity: "medium",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.single-source.enabled", "rules.bom.single-source.severity", "bom.alternates"],
    checks: "Checks supplier columns for parts that only list one source.",
    fires:
      "Fires when supplier metadata is present and a row has a single supplier and no approved alternates are configured for its MPN.",
    details: "{ reference, mpn, supplier }",
  },
  {
    id: "bom.identity-conflicts",
    severity: "high",
    appliesTo: ["bom", "schematic"],
    configKeys: ["rules.bom.identity-conflicts.enabled", "rules.bom.identity-conflicts.severity"],
    checks:
      "Checks for components whose identity fields (MPN, manufacturer) differ between BOM and schematic sources, or appear multiple times within the same BOM with conflicting values.",
    fires:
      "Fires when the same reference designator has inconsistent MPNs across sources. Covers both within-BOM duplicate rows and BOM-vs-schematic conflicts.",
    details: "{ reference, conflictType, mpns } or { reference, conflictType, bomMpn, schematicMpn }",
  },
  {
    id: "bom.risk-score",
    severity: "medium",
    appliesTo: ["bom"],
    configKeys: [
      "rules.bom.risk-score.enabled",
      "rules.bom.risk-score.severity",
      "rules.bom.risk-score.critical-severity",
      "rules.bom.risk-score.high-severity",
      "rules.bom.risk-score.medium-severity",
      "rules.bom.risk-score.low-severity",
      "rules.bom.risk-score.weights.missing-mpn",
      "rules.bom.risk-score.weights.missing-manufacturer",
      "rules.bom.risk-score.weights.no-suppliers",
      "rules.bom.risk-score.weights.single-source-no-alternates",
      "bom.alternates",
    ],
    checks:
      "Scores each populated BOM row on missing MPN, missing manufacturer, no suppliers, and single-source-without-alternates signals.",
    fires:
      "Fires for each non-DNP row with a non-zero risk score. Severity is mapped from the component risk level (critical/high/medium/low) and is configurable per level.",
    details:
      "{ reference, mpn, manufacturer, riskScore, riskLevel, factors: { missingMpn, missingManufacturer, noSuppliers, singleSourceNoAlternates }, overallBomRiskScore, totalComponents }",
  },
  {
    id: "bom.eol-detection",
    severity: "high",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.eol-detection.enabled", "rules.bom.eol-detection.severity"],
    checks: "Checks lifecycle-style columns for local end-of-life markers.",
    fires: "Fires when lifecycle text indicates obsolete, NRND, discontinued, or EOL status.",
    details: "{ reference, mpn, lifecycle }",
  },
  {
    id: "bom.lifecycle",
    severity: "medium",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.lifecycle.enabled", "rules.bom.lifecycle.db"],
    checks:
      "Checks BOM lifecycle columns or a local lifecycle database for EOL, NRND, preview, and discontinued markers.",
    fires: "Fires when a component lifecycle status carries release or sourcing risk.",
    details: "{ reference, mpn, lifecycle }",
  },
  {
    id: "bom.footprint-mismatch",
    severity: "medium",
    appliesTo: ["bom", "pcb"],
    configKeys: ["rules.bom.footprint-mismatch.enabled", "rules.bom.footprint-mismatch.severity"],
    checks: "Compares normalized BOM footprint strings with PCB footprint assignments.",
    fires: "Fires when a reference appears in both sources with different footprints.",
    details: "{ reference, bomFootprint, pcbFootprint }",
  },
  {
    id: "bom.dnp-consistency",
    severity: "medium",
    appliesTo: ["bom", "pcb"],
    configKeys: ["rules.bom.dnp-consistency.enabled", "rules.bom.dnp-consistency.severity"],
    checks: "Compares BOM DNP flags with PCB footprint population attributes.",
    fires: "Fires when BOM and PCB disagree on populated versus DNP state.",
    details: "{ reference, bomDnp, pcbDnp }",
  },
  {
    id: "bom.variant-consistency",
    severity: "high",
    appliesTo: ["bom", "project"],
    configKeys: ["projects.variants", "rules.bom.variant-consistency.enabled"],
    checks: "Checks KiCad 10 variant DNP overrides against each variant-specific BOM.",
    fires: "Fires when a component disabled by the active variant still appears populated in that variant BOM.",
    details: "{ variant, reference }",
  },
  {
    id: "bom.compliance",
    severity: "high",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.compliance.enabled", "rules.bom.compliance.require", "rules.bom.compliance.severity"],
    checks: "Checks populated BOM components for RoHS/REACH compliance metadata when explicitly enabled.",
    fires:
      "Fires when a populated component is marked non-compliant, or (with require) when it has no compliance data.",
    details: "{ reference, mpn, compliance? }",
  },
  {
    id: "design.copper-balance",
    severity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.copper-balance.enabled", "rules.design.copper-balance.min-coverage-percent"],
    checks: "Checks filled copper area per layer against board area to identify low copper coverage.",
    fires: "Fires when a copper layer is below the configured minimum coverage percentage.",
    details: "{ layer, coveragePercent, minimum }",
  },
  {
    id: "design.board-outline",
    severity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.board-outline.enabled"],
    checks: "Checks that the PCB Edge.Cuts outline is present and closed.",
    fires: "Fires when Edge.Cuts segments do not form a closed outline.",
    details: "{ outlineClosed }",
  },
  {
    id: "design.unique-references",
    severity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.unique-references.enabled", "rules.design.unique-references.ignore-refs"],
    checks: "Checks board footprints for duplicate reference designators.",
    fires: "Fires when the rule is enabled and a reference designator is used by more than one footprint.",
    details: "{ reference, count }",
  },
  {
    id: "pinmap.verify",
    severity: "high",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["rules.pinmap.verify.enabled", "rules.pinmap.verify.severity"],
    checks: "Checks configured pinmap nets against schematic net labels.",
    fires: "Fires when a pinmap entry points at a net not present in the schematic.",
    details: "{ entry }",
  },
  {
    id: "pinmap.unmapped-pin",
    severity: "medium",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["rules.pinmap.unmapped-pin.enabled", "rules.pinmap.unmapped-pin.severity"],
    checks: "Checks connected schematic pins against pinmap entries.",
    fires: "Fires when a connected schematic pin has no matching pinmap entry.",
    details: "{ designator, pin, net }",
  },
  {
    id: "pinmap.collision",
    severity: "high",
    appliesTo: ["pinmap"],
    configKeys: ["rules.pinmap.collision.enabled", "rules.pinmap.collision.severity"],
    checks: "Checks pinmap files for duplicate pin or net assignments.",
    fires: "Fires when a pin key or net key appears more than once.",
    details: "{ key, kind }",
  },
  {
    id: "pinmap.net-label",
    severity: "medium",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["rules.pinmap.net-label.enabled", "pinmap", "projects.pinmap"],
    checks: "Checks pinmap net names against schematic global, local, and hierarchical labels.",
    fires: "Fires when a pinmap net has no matching schematic label.",
    details: "{ net, entry }",
  },
  {
    id: "firmware.platformio-pin-contract",
    severity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.platformio.pinAssignments",
      "projects.firmware.platformio.pinAssignments",
      "rules.firmware.platformio-pin-contract.file",
    ],
    checks: "Checks a PlatformIO-style firmware pin contract against BoardReadyOps pinmap firmware labels.",
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  {
    id: "firmware.arduino-pin-contract",
    severity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.arduino.pinAssignments",
      "projects.firmware.arduino.pinAssignments",
      "rules.firmware.arduino-pin-contract.file",
    ],
    checks: "Checks an Arduino/C `#define` firmware pin header against BoardReadyOps pinmap firmware labels.",
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  {
    id: "firmware.zephyr-pin-contract",
    severity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.zephyr.pinAssignments",
      "projects.firmware.zephyr.pinAssignments",
      "rules.firmware.zephyr-pin-contract.file",
    ],
    checks: "Checks a Zephyr firmware pin contract YAML against BoardReadyOps pinmap firmware labels.",
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  {
    id: "firmware.esp-idf-pin-contract",
    severity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.esp-idf.pinAssignments",
      "projects.firmware.esp-idf.pinAssignments",
      "rules.firmware.esp-idf-pin-contract.file",
    ],
    checks: "Checks an ESP-IDF firmware pin contract YAML against BoardReadyOps pinmap firmware labels.",
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  {
    id: "firmware.stm32cubemx-pin-contract",
    severity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.stm32cubemx.project",
      "projects.firmware.stm32cubemx.project",
      "rules.firmware.stm32cubemx-pin-contract.file",
      "rules.firmware.stm32cubemx-pin-contract.mcu-designator",
    ],
    checks:
      "Parses a STM32CubeMX `.ioc` project file and checks GPIO labels against BoardReadyOps pinmap firmware labels.",
    fires:
      "Fires when GPIO labels disagree with the hardware pinmap, when extra labels exist, or when hardware firmware signals are missing from the .ioc file.",
    details: "{ firmware, hardware, sources }",
  },
  {
    id: "manufacturing.package-completeness",
    severity: "high",
    appliesTo: ["manifest", "pcb"],
    configKeys: ["rules.manufacturing.package-completeness.severity"],
    checks:
      "Checks that all required manufacturing output categories are present. " +
      "Base categories (gerbers, drill, drill-report, BOM, CPL) are required for every release. " +
      "Production categories (fab-notes, assembly-notes, board-pdf) are additionally required when releaseMode is production.",
    fires: "Fires for each missing output category with a structured completeness breakdown.",
    details: "{ missingCategory, requirementLevel, completenessScore, presentCategories, missingCategories }",
  },
  {
    id: "manufacturing.outputs-present",
    severity: "high",
    appliesTo: ["manifest", "pcb"],
    configKeys: [
      "vendor.profile",
      "vendor.service",
      "vendor.required",
      "rules.manufacturing.outputs-present.required",
      "rules.manufacturing.outputs-present.patterns",
    ],
    checks: "Checks configured and vendor-profile fabrication output patterns and freshness against PCB source mtimes.",
    fires: "Fires when a configured or vendor-profile required output is missing or older than the PCB.",
    details: "{ required, vendorProfile?, vendorAssumptions? }",
  },
  {
    id: "manufacturing.jobset-outputs",
    severity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.jobset-outputs.enabled"],
    checks: "Checks enabled KiCad 10 jobset entries for their expected output files.",
    fires: "Fires when an enabled jobset output path does not exist.",
    details: "{ type, outputPath }",
  },
  {
    id: "manufacturing.panel-sanity",
    severity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.panel-sanity.panelized"],
    checks: "Checks that panelized builds include expected panel output files.",
    fires: "Fires when panelization is enabled but no panel output is present.",
    details: "{ panelized }",
  },
  {
    id: "manufacturing.fab-notes",
    severity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.fab-notes.enabled"],
    checks: "Checks for fabrication notes in known project paths.",
    fires: "Fires when no fabrication notes file is present.",
    details: "{ expectedPaths }",
  },
  {
    id: "manufacturing.drill-coverage",
    severity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.drill-coverage.enabled"],
    checks: "Checks parsed PCB drill sizes against generated Excellon drill files.",
    fires: "Fires when a PCB drill size is absent from drill output.",
    details: "{ missingDrills }",
  },
  {
    id: "manufacturing.layer-stackup",
    severity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.layer-stackup.enabled", "rules.manufacturing.layer-stackup.expected-layers"],
    checks: "Checks KiCad PCB stackup layer count against expected copper layers.",
    fires: "Fires when the stackup block contains a different copper layer count than expected.",
    details: "{ expectedLayers, stackupLayers }",
  },
  {
    id: "manufacturing.fiducials",
    severity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.fiducials.enabled", "rules.manufacturing.fiducials.minimum"],
    checks: "Checks explicitly enabled assembly jobs for minimum fiducial footprint coverage.",
    fires: "Fires when the parsed PCB has fewer fiducial references than the configured minimum.",
    details: "{ required, found }",
  },
  {
    id: "manufacturing.test-points",
    severity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.test-points.enabled", "rules.manufacturing.test-points.minimum"],
    checks: "Checks explicitly enabled assembly jobs for minimum test point footprint coverage.",
    fires: "Fires when the parsed PCB has fewer test point references than the configured minimum.",
    details: "{ required, found }",
  },
  {
    id: "manufacturing.assembly-sides",
    severity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.assembly-sides.enabled", "rules.manufacturing.assembly-sides.allow-bottom-side"],
    checks: "Checks explicitly enabled assembly jobs for components placed on the bottom copper layer.",
    fires: "Fires when assembly components are on the bottom side and bottom-side placement is not allowed.",
    details: "{ bottomSideCount, references }",
  },
  {
    id: "manufacturing.tooling-holes",
    severity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.tooling-holes.enabled", "rules.manufacturing.tooling-holes.minimum"],
    checks: "Checks explicitly enabled manufacturing jobs for minimum tooling or mounting hole coverage.",
    fires: "Fires when the parsed PCB has fewer tooling-hole candidates than the configured minimum.",
    details: "{ required, found }",
  },
  {
    id: "manufacturing.position-coverage",
    severity: "medium",
    appliesTo: ["pcb", "manifest"],
    configKeys: ["rules.manufacturing.position-coverage.enabled", "rules.manufacturing.position-coverage.patterns"],
    checks: "Checks explicitly enabled assembly jobs for populated reference coverage in position/CPL outputs.",
    fires: "Fires when no position output exists or populated references are missing from position/CPL output text.",
    details: "{ missingRefs, totalMissingRefs, positionFiles? }",
  },
  {
    id: "release.revision-set",
    severity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.release.revision-set.tag-pattern"],
    checks: "Checks board title-block revisions against the configured release tag pattern.",
    fires: "Fires when revision is empty or does not match the configured pattern.",
    details: "{ revision, tagPattern }",
  },
  {
    id: "release.changelog-present",
    severity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.release.changelog-present.enabled"],
    checks: "Checks CHANGELOG.md for an entry matching the current board revision.",
    fires: "Fires when CHANGELOG.md is missing or lacks the current revision entry.",
    details: "{ revision }",
  },
  {
    id: "release.tag-matches-revision",
    severity: "high",
    appliesTo: ["manifest", "pcb"],
    configKeys: ["rules.release.tag-matches-revision.enabled"],
    checks: "Checks tag CI context against board revision.",
    fires: "Fires when GITHUB_REF_TYPE=tag and GITHUB_REF_NAME does not match the revision.",
    details: "{ revision, tag }",
  },
  {
    id: "release.version-format",
    severity: "low",
    appliesTo: ["pcb", "schematic"],
    configKeys: ["rules.release.version-format.enabled", "rules.release.version-format.pattern"],
    checks: "Checks schematic and PCB revision strings against the configured release version pattern.",
    fires: "Fires when a revision does not match vMAJOR.MINOR or rMAJOR.MINOR by default.",
    details: "{ revision, pattern }",
  },
];

const groups = new Map();
for (const item of rules) {
  const group = item.id.split(".")[0];
  if (!groups.has(group)) {
    groups.set(group, []);
  }
  groups.get(group).push(item);
}

await mkdir("docs/rules", { recursive: true });
await writeFile(
  "docs/rules/index.md",
  `# Rules

BoardReadyOps rules use stable \`group.rule\` identifiers. Each rule page records the default severity, applicable input type, configuration keys, details shape, and reporting context.

${rules.map((rule) => `- [${rule.id}](${rule.id}.md)`).join("\n")}
`,
  "utf8",
);

for (const [group, items] of groups) {
  await writeFile(
    `docs/rules/${group}.md`,
    `# ${title(group)} Rules

${items.map((rule) => `- [${rule.id}](${rule.id}.md): ${rule.checks}`).join("\n")}
`,
    "utf8",
  );
}

for (const rule of rules) {
  await writeFile(`docs/rules/${rule.id}.md`, renderRule(rule), "utf8");
}

function renderRule(rule) {
  return `---
id: ${rule.id}
severity-default: ${rule.severity}
applies-to:
${rule.appliesTo.map((entry) => `  - ${entry}`).join("\n")}
config-keys:
${rule.configKeys.map((entry) => `  - ${entry}`).join("\n")}
---

# ${rule.id}

## What It Checks

${rule.checks}

## When It Fires

${rule.fires}

## Configuration Example

\`\`\`yaml
version: 1
rules:
  ${rule.id}:
    enabled: true
    severity: ${rule.severity}
\`\`\`

## JSON Finding Details Shape

\`\`\`text
${rule.details}
\`\`\`

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
`;
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
