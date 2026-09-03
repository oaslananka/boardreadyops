import path from "node:path";
import { parsePcb } from "../../kicad/pcb.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const boardOutlineRule = rule(
  {
    id: "design.board-outline",
    title: "PCB outline is not closed",
    description: "Checks that the PCB Edge.Cuts outline is present and closes into a board boundary.",
    rationale: "Fabricators need a closed outline to route the intended physical board shape.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.board-outline.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["design", "edge-cuts", "pcb"],
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "design.board-outline")) {
      return [];
    }
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const parsed = await parsePcb(path.resolve(context.root, board));
        if (!parsed.outlineClosed) {
          output.push(
            finding(context, {
              ruleId: "design.board-outline",
              severity: configuredSeverity(context, "design.board-outline", "high"),
              message: "PCB Edge.Cuts outline is open or missing.",
              path: board,
              kind: "pcb",
              details: { outlineClosed: false },
            }),
          );
        }
      }
    }
    return output;
  },
);
