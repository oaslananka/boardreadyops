import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

/**
 * Rule pages are generated from the rule registry the engine actually runs, not from a copy.
 *
 * They used to be generated from a hand-maintained array here, and it drifted: four registered
 * rules -- `bom.unknown-lifecycle` and the three `manufacturing.dfm-*` checks -- were never added
 * to it, so `docs/rules.md` and the published rule pages simply did not mention checks the
 * product performs. Nothing could notice, because the array was the only source.
 *
 * Now the facts come from the registry and only the prose lives here. A registered rule with no
 * prose fails this script rather than being quietly skipped, which is the property the old shape
 * could not have.
 */

/**
 * What a rule's own metadata cannot carry: the precise firing condition and the shape of the
 * `details` object in a JSON finding. Keyed by rule id.
 */
const narratives = {
  "bom.compliance": {
    fires:
      "Fires when a populated component is marked non-compliant, or (with require) when it has no compliance data.",
    details: "{ reference, mpn, compliance? }",
  },
  "bom.dnp-consistency": {
    fires: "Fires when BOM and PCB disagree on populated versus DNP state.",
    details: "{ reference, bomDnp, pcbDnp }",
  },
  "bom.eol-detection": {
    fires: "Fires when lifecycle text indicates obsolete, NRND, discontinued, or EOL status.",
    details: "{ reference, mpn, lifecycle }",
  },
  "bom.footprint-mismatch": {
    fires: "Fires when a reference appears in both sources with different footprints.",
    details: "{ reference, bomFootprint, pcbFootprint }",
  },
  "bom.identity-conflicts": {
    fires:
      "Fires when the same reference designator has inconsistent MPNs across sources. Covers both within-BOM duplicate rows and BOM-vs-schematic conflicts.",
    details: "{ reference, conflictType, mpns } or { reference, conflictType, bomMpn, schematicMpn }",
  },
  "bom.lifecycle": {
    fires: "Fires when a component lifecycle status carries release or sourcing risk.",
    details: "{ reference, mpn, lifecycle }",
  },
  "bom.missing-mpn": {
    fires: "Fires when a populated BOM row has no MPN and the reference is not ignored.",
    details: "{ reference, value, footprint }",
  },
  "bom.risk-score": {
    fires:
      "Fires for each non-DNP row with a non-zero risk score. Severity is mapped from the component risk level (critical/high/medium/low) and is configurable per level.",
    details:
      "{ reference, mpn, manufacturer, riskScore, riskLevel, factors: { missingMpn, missingManufacturer, noSuppliers, singleSourceNoAlternates }, overallBomRiskScore, totalComponents }",
  },
  "bom.single-source": {
    fires:
      "Fires when supplier metadata is present and a row has a single supplier and no approved alternates are configured for its MPN.",
    details: "{ reference, mpn, supplier }",
  },
  "bom.unknown-lifecycle": {
    fires:
      "Fires for each populated BOM row whose lifecycle status cannot be resolved from the BOM field, the lifecycle cache, or a supplier plugin.",
    details: "{ reference, mpn, manufacturer }",
  },
  "bom.variant-consistency": {
    fires: "Fires when a component disabled by the active variant still appears populated in that variant BOM.",
    details: "{ variant, reference }",
  },
  "design.board-outline": {
    fires: "Fires when Edge.Cuts segments do not form a closed outline.",
    details: "{ outlineClosed }",
  },
  "design.copper-balance": {
    fires: "Fires when a copper layer is below the configured minimum coverage percentage.",
    details: "{ layer, coveragePercent, minimum }",
  },
  "design.unique-references": {
    fires: "Fires when the rule is enabled and a reference designator is used by more than one footprint.",
    details: "{ reference, count }",
  },
  "drc.kicad": {
    fires: "Fires for every KiCad DRC diagnostic in the JSON report.",
    details: "{ source: 'kicad-cli', diagnostic: <KiCad diagnostic object> }",
  },
  "erc.kicad": {
    fires: "Fires for every KiCad ERC diagnostic in the JSON report.",
    details: "{ source: 'kicad-cli', diagnostic: <KiCad diagnostic object> }",
  },
  "firmware.arduino-pin-contract": {
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  "firmware.esp-idf-pin-contract": {
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  "firmware.platformio-pin-contract": {
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  "firmware.stm32cubemx-pin-contract": {
    fires:
      "Fires when GPIO labels disagree with the hardware pinmap, when extra labels exist, or when hardware firmware signals are missing from the .ioc file.",
    details: "{ firmware, hardware, sources }",
  },
  "firmware.zephyr-pin-contract": {
    fires:
      "Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.",
    details: "{ firmware, hardware, sources }",
  },
  "manufacturing.assembly-sides": {
    fires: "Fires when assembly components are on the bottom side and bottom-side placement is not allowed.",
    details: "{ bottomSideCount, references }",
  },
  "manufacturing.dfm-pin1-markers": {
    fires:
      "Fires for each IC or polarised connector whose footprint is not a recognized library footprint carrying a standard pin-1 marker.",
    details: "{ reference, footprint }",
  },
  "manufacturing.dfm-polarity-markers": {
    fires:
      "Fires for each polarized component -- diode, LED, or electrolytic capacitor -- whose footprint is not a recognized library footprint carrying a standard polarity marking.",
    details: "{ reference, footprint }",
  },
  "manufacturing.dfm-silkscreen-over-pad": {
    fires:
      "Fires once per board when the SMD component count reaches the configured density threshold, as a reminder to enable KiCad DRC silkscreen clearance for production.",
    details: "{ smdCount, minimumSmdCount }",
  },
  "manufacturing.drill-coverage": {
    fires: "Fires when a PCB drill size is absent from drill output.",
    details: "{ missingDrills }",
  },
  "manufacturing.fab-notes": {
    fires: "Fires when no fabrication notes file is present.",
    details: "{ expectedPaths }",
  },
  "manufacturing.fiducials": {
    fires: "Fires when the parsed PCB has fewer fiducial references than the configured minimum.",
    details: "{ required, found }",
  },
  "manufacturing.jobset-outputs": {
    fires: "Fires when an enabled jobset output path does not exist.",
    details: "{ type, outputPath }",
  },
  "manufacturing.layer-stackup": {
    fires: "Fires when the stackup block contains a different copper layer count than expected.",
    details: "{ expectedLayers, stackupLayers }",
  },
  "manufacturing.outputs-present": {
    fires: "Fires when a configured or vendor-profile required output is missing or older than the PCB.",
    details: "{ required, vendorProfile?, vendorAssumptions? }",
  },
  "manufacturing.package-completeness": {
    fires: "Fires for each missing output category with a structured completeness breakdown.",
    details: "{ missingCategory, requirementLevel, completenessScore, presentCategories, missingCategories }",
  },
  "manufacturing.panel-sanity": {
    fires: "Fires when panelization is enabled but no panel output is present.",
    details: "{ panelized }",
  },
  "manufacturing.position-coverage": {
    fires: "Fires when no position output exists or populated references are missing from position/CPL output text.",
    details: "{ missingRefs, totalMissingRefs, positionFiles? }",
  },
  "manufacturing.test-points": {
    fires: "Fires when the parsed PCB has fewer test point references than the configured minimum.",
    details: "{ required, found }",
  },
  "manufacturing.tooling-holes": {
    fires: "Fires when the parsed PCB has fewer tooling-hole candidates than the configured minimum.",
    details: "{ required, found }",
  },
  "pinmap.collision": {
    fires: "Fires when a pin key or net key appears more than once.",
    details: "{ key, kind }",
  },
  "pinmap.net-label": {
    fires: "Fires when a pinmap net has no matching schematic label.",
    details: "{ net, entry }",
  },
  "pinmap.unmapped-pin": {
    fires: "Fires when a connected schematic pin has no matching pinmap entry.",
    details: "{ designator, pin, net }",
  },
  "pinmap.verify": {
    fires: "Fires when a pinmap entry points at a net not present in the schematic.",
    details: "{ entry }",
  },
  "release.changelog-present": {
    fires: "Fires when CHANGELOG.md is missing or lacks the current revision entry.",
    details: "{ revision }",
  },
  "release.revision-set": {
    fires: "Fires when revision is empty or does not match the configured pattern.",
    details: "{ revision, tagPattern }",
  },
  "release.tag-matches-revision": {
    fires: "Fires when GITHUB_REF_TYPE=tag and GITHUB_REF_NAME does not match the revision.",
    details: "{ revision, tag }",
  },
  "release.version-format": {
    fires: "Fires when a revision does not match vMAJOR.MINOR or rMAJOR.MINOR by default.",
    details: "{ revision, pattern }",
  },
};

/** Bundles the registry so this plain-Node script can read the TypeScript source of truth. */
async function loadRegisteredRules() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-rule-docs-"));
  const outfile = path.join(directory, "registry.cjs");
  try {
    await build({
      entryPoints: ["scripts/rule-registry-entry.mjs"],
      outfile,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      logLevel: "silent",
    });
    const require = createRequire(import.meta.url);
    const { registerBuiltInRules, listRules } = require(outfile);
    registerBuiltInRules();
    return listRules().map((entry) => entry.meta);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const registered = await loadRegisteredRules();

const undocumented = registered.filter((rule) => !narratives[rule.id]).map((rule) => rule.id);
if (undocumented.length > 0) {
  throw new Error(
    `these rules are registered but have no documentation prose in scripts/generate-rule-docs.mjs:\n  ${undocumented.join("\n  ")}\n` +
      "Add a `fires` and `details` entry for each. Generated pages must cover every rule the engine runs.",
  );
}

const orphaned = Object.keys(narratives).filter((id) => !registered.some((rule) => rule.id === id));
if (orphaned.length > 0) {
  throw new Error(
    `these rules have documentation prose but are not registered:\n  ${orphaned.join("\n  ")}\n` +
      "Remove the entry, or register the rule.",
  );
}

// `checks` is the rule's own description -- the registry already states what it checks, so
// restating it here is what let the two disagree.
const rules = registered
  .map((rule) => ({
    id: rule.id,
    severity: rule.defaultSeverity,
    appliesTo: rule.appliesTo,
    configKeys: rule.configKeys,
    checks: rule.description,
    fires: narratives[rule.id].fires,
    details: narratives[rule.id].details,
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

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
