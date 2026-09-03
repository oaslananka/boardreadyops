import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { parsePcb } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const copperBalanceRule = rule(
  {
    id: "design.copper-balance",
    title: "PCB copper coverage is below the configured balance threshold",
    description: "Checks filled copper coverage on PCB layers against the configured minimum.",
    rationale: "Low copper coverage can flag process and board-quality risks before release.",
    defaultSeverity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.copper-balance.min-coverage-percent"],
    kicadVersions: ["9", "10", "future"],
    tags: ["copper", "design", "pcb"],
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "design.copper-balance")) {
      return [];
    }
    const rawMinimum = configFor(context, "design.copper-balance")["min-coverage-percent"];
    const minimum = typeof rawMinimum === "number" ? rawMinimum : 15;
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        output.push(...(await checkBoardCopperBalance(context, board, minimum)));
      }
    }
    return output;
  },
);

async function checkBoardCopperBalance(context: RuleContext, board: string, minimum: number) {
  const output = [];
  const parsed = await parsePcb(path.resolve(context.root, board));
  if (!parsed.boardArea || parsed.boardArea <= 0) {
    return [];
  }
  const layers = parsed.copperLayers.length > 0 ? parsed.copperLayers : [...parsed.copperAreas.keys()];
  for (const layer of layers) {
    const area = parsed.copperAreas.get(layer) ?? 0;
    const coveragePercent = (area / parsed.boardArea) * 100;
    if (coveragePercent < minimum) {
      output.push(
        finding(context, {
          ruleId: "design.copper-balance",
          severity: configuredSeverity(context, "design.copper-balance", "low"),
          message: `${layer} copper coverage is ${coveragePercent.toFixed(1)}%, below ${minimum}%.`,
          path: board,
          kind: "pcb",
          details: { layer, coveragePercent, minimum },
        }),
      );
    }
  }
  return output;
}
