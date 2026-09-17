import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { normalizeGerberStackup } from "../../multicad/gerber-normalizer.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { assemblyFootprints, footprintSide, parsedBoards } from "./shared.js";

/**
 * A side with surface-mount assembly components needs a solder paste layer in the Gerber package.
 *
 * Solder paste artwork (F.Paste / B.Paste) is required by SMT stencil cut machines to apply paste
 * to surface-mount pads before component placement. If a board side contains surface-mount components
 * (or mixed components with SMT pads), a paste layer is required on that side.
 *
 * Board sides containing only through-hole components, DNP components, or board-only/mechanical
 * footprints do NOT require a paste layer.
 *
 * Part of #770.
 */

const gerberPatterns = [
  "**/*.gbr",
  "**/*.gtl",
  "**/*.gbl",
  "**/*.gts",
  "**/*.gbs",
  "**/*.gto",
  "**/*.gbo",
  "**/*.gtp",
  "**/*.gbp",
  "**/*.gko",
  "**/*.gm1",
];

export const pasteCoverageRule = rule(
  {
    id: "manufacturing.paste-coverage",
    title: "An assembly side with SMT components has no solder paste layer",
    description:
      "Checks that each board side containing surface-mount assembly components has a matching solder paste layer in the Gerber package.",
    rationale:
      "Surface-mount assembly requires a stencil paste layer (F.Paste / B.Paste) to deposit solder paste on SMT pads.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.paste-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["fabrication", "manufacturing", "gerber", "paste", "assembly"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.paste-coverage")) {
      return [];
    }

    const boards = await parsedBoards(context);
    if (boards.length === 0) {
      return [];
    }

    const files = await globFiles(context.root, gerberPatterns);
    if (files.length === 0) {
      // Missing Gerber outputs as a whole is handled by manufacturing.outputs-present.
      return [];
    }

    const entries = await Promise.all(
      files.map(async (file) => ({
        filename: path.relative(context.root, file),
        content: (await readTextFile(file).catch(() => undefined)) ?? undefined,
      })),
    );
    const stackup = normalizeGerberStackup(entries);

    const findings = [];

    for (const board of boards) {
      const activeAssembly = assemblyFootprints(board.footprints);

      for (const side of ["top", "bottom"] as const) {
        const smtFootprintsOnSide = activeAssembly.filter(
          (f) =>
            footprintSide(f) === side &&
            (f.mountType === "surface-mount" || f.mountType === "mixed"),
        );

        if (smtFootprintsOnSide.length === 0) {
          continue;
        }

        const hasPasteLayer = stackup.layers.some(
          (layer) => layer.role === "solderpaste" && layer.side === side,
        );

        if (!hasPasteLayer) {
          findings.push(
            finding(context, {
              ruleId: "manufacturing.paste-coverage",
              severity: configuredSeverity(context, "manufacturing.paste-coverage", "high"),
              message: `The board has ${smtFootprintsOnSide.length} surface-mount component(s) on ${side} but the Gerber package has no ${side} solder paste layer.`,
              path: board.path,
              kind: "pcb",
              details: {
                side,
                smtComponentCount: smtFootprintsOnSide.length,
                references: smtFootprintsOnSide.map((f) => f.reference),
              },
              fix: {
                description: `Export the ${side} solder paste layer (${side === "top" ? "F.Paste" : "B.Paste"}) and include it in the Gerber package.`,
                steps: [
                  "In KiCad, open File > Fabrication Outputs > Gerbers.",
                  `Tick ${side === "top" ? "F.Paste" : "B.Paste"} in the layer list.`,
                  "Re-export and update the Gerber package.",
                ],
              },
            }),
          );
        }
      }
    }

    return findings;
  },
);
