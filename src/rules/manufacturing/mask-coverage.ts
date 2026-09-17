import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadNormalizedGerberStackup } from "./shared.js";

/**
 * Every side with copper needs a solder mask on that side.
 *
 * Fabricators will build a board whose mask set is short a side, and the result is exposed copper
 * across the whole face: solder bridges everywhere at assembly, and a batch that has to be
 * scrapped rather than reworked. `manufacturing.outputs-present` already checks that a Gerber set
 * exists, by filename pattern against the vendor profile; it cannot tell whether the set is
 * complete, because it never opens a file.
 *
 * Inner copper is deliberately not checked. Mask applies to the outer faces, so requiring one per
 * copper layer would report a finding on every four-layer board.
 *
 * Severity is medium rather than high, so it warns rather than blocks at the default threshold.
 * Layer roles come from each file's own `TF.FileFunction` where it declares one and from the
 * filename otherwise, and the normalizer does not yet report which of the two it used per layer.
 * Blocking a release on a classification that may have come from a filename is the mistake #753
 * argues turns the gate off; this can move to high once layer identity carries its provenance.
 *
 * Part of #770.
 */

export const maskCoverageRule = rule(
  {
    id: "manufacturing.mask-coverage",
    title: "A copper side has no solder mask",
    description: "Checks that each outer copper side in the Gerber package has a matching solder mask layer.",
    rationale: "A board built without a mask on one face leaves that whole face exposed, which bridges at assembly.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.mask-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["fabrication", "manufacturing", "gerber", "mask"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.mask-coverage")) {
      return [];
    }

    const loaded = await loadNormalizedGerberStackup(context);
    if (!loaded) {
      return [];
    }
    const { stackup, entries } = loaded;

    const output = [];
    for (const side of ["top", "bottom"] as const) {
      const hasCopper = stackup.layers.some((layer) => layer.role === "copper" && layer.side === side);
      if (!hasCopper) continue;
      if (stackup.layers.some((layer) => layer.role === "soldermask" && layer.side === side)) continue;

      output.push(
        finding(context, {
          ruleId: "manufacturing.mask-coverage",
          severity: configuredSeverity(context, "manufacturing.mask-coverage", "medium"),
          message: `The Gerber package has ${side} copper but no ${side} solder mask layer.`,
          path: entries[0]?.filename ?? ".",
          kind: "pcb",
          details: {
            side,
            copperLayers: stackup.layers.filter((layer) => layer.role === "copper").length,
            maskLayers: stackup.layers.filter((layer) => layer.role === "soldermask").length,
          },
          fix: {
            description: `Export the ${side} solder mask layer and include it in the fabrication package.`,
            steps: [
              "In KiCad, open File > Fabrication Outputs > Gerbers.",
              `Tick ${side === "top" ? "F.Mask" : "B.Mask"} in the layer list.`,
              "Re-export and replace the package.",
            ],
          },
        }),
      );
    }
    return output;
  },
);
