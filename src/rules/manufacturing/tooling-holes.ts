import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { isToolingHole, parsedBoards, positiveInteger } from "./shared.js";

export const toolingHolesRule = rule(
  {
    id: "manufacturing.tooling-holes",
    title: "Tooling holes are missing",
    description: "Checks configured fabrication/assembly jobs for a minimum number of tooling or mounting holes.",
    rationale: "Tooling holes help fixture, panel, and assembly workflows locate the board mechanically.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.tooling-holes.minimum"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "dfm", "manufacturing", "pcb"],
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.tooling-holes")) {
      return [];
    }
    const config = configFor(context, "manufacturing.tooling-holes");
    if (config.enabled !== true) {
      return [];
    }
    const minimum = positiveInteger(config.minimum, 2);
    const output = [];
    for (const board of await parsedBoards(context)) {
      const found = board.footprints.filter(isToolingHole).length;
      if (found < minimum) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.tooling-holes",
            severity: configuredSeverity(context, "manufacturing.tooling-holes", "medium"),
            message: `Manufacturing requires at least ${minimum} tooling holes, found ${found}.`,
            path: board.path,
            kind: "pcb",
            details: { required: minimum, found },
          }),
        );
      }
    }
    return output;
  },
);
