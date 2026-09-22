import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import {
  assemblyFootprints,
  DEFAULT_GERBER_PATTERNS,
  footprintSide,
  loadGerberStackup,
  parsedBoards,
} from "./shared.js";

export const pasteCoverageRule = rule(
  {
    id: "manufacturing.paste-coverage",
    title: "An assembly side with SMT components has no solder paste layer",
    description: "Checks that each side with SMT components in the Gerber package has a matching solder paste layer.",
    rationale:
      "Surface-mount assembly requires a stencil layer to apply solder paste to pads before component placement.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.paste-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "fabrication", "gerber", "manufacturing", "paste"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.paste-coverage")) {
      return [];
    }

    const files = await globFiles(context.root, DEFAULT_GERBER_PATTERNS);
    if (files.length === 0) {
      return [];
    }

    const boards = await parsedBoards(context);
    const topSmt = boards.some((board) =>
      assemblyFootprints(board.footprints).some(
        (fp) => footprintSide(fp) === "top" && fp.mountType !== "through_hole" && fp.mountType !== "virtual",
      ),
    );
    const bottomSmt = boards.some((board) =>
      assemblyFootprints(board.footprints).some(
        (fp) => footprintSide(fp) === "bottom" && fp.mountType !== "through_hole" && fp.mountType !== "virtual",
      ),
    );

    if (!topSmt && !bottomSmt) {
      return [];
    }

    const { entries, stackup } = await loadGerberStackup(context.root, files);

    const output = [];
    const sidesToCheck: Array<"top" | "bottom"> = [];
    if (topSmt) sidesToCheck.push("top");
    if (bottomSmt) sidesToCheck.push("bottom");

    for (const side of sidesToCheck) {
      const hasPaste = stackup.layers.some((layer) => layer.role === "solderpaste" && layer.side === side);
      if (!hasPaste) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.paste-coverage",
            severity: configuredSeverity(context, "manufacturing.paste-coverage", "medium"),
            message: `The board has SMT assembly on the ${side} side, but the Gerber package lacks a ${side} solder paste stencil layer.`,
            path: entries[0]?.filename ?? ".",
            kind: "pcb",
            details: {
              side,
              pasteLayers: stackup.layers.filter((layer) => layer.role === "solderpaste").length,
            },
            fix: {
              description: `Export the ${side} solder paste layer (${side === "top" ? "F.Paste" : "B.Paste"}) and include it in the Gerber package.`,
              steps: [
                "In KiCad, open File > Fabrication Outputs > Gerbers.",
                `Tick ${side === "top" ? "F.Paste" : "B.Paste"} in the layer list.`,
                "Re-export and update the package.",
              ],
            },
          }),
        );
      }
    }

    return output;
  },
);
