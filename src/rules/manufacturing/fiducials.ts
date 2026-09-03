import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { isFiducial, parsedBoards, positiveInteger } from "./shared.js";

export const fiducialsRule = rule(
  {
    id: "manufacturing.fiducials",
    title: "Assembly fiducials are missing",
    description: "Checks configured assembly jobs for a minimum number of fiducial footprints.",
    rationale: "Fiducials help assembly equipment align the board reliably before pick-and-place.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.fiducials.minimum"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "manufacturing", "pcb"],
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.fiducials")) {
      return [];
    }
    const config = configFor(context, "manufacturing.fiducials");
    if (config.enabled !== true) {
      return [];
    }
    const minimum = positiveInteger(config.minimum, 2);
    const output = [];
    for (const board of await parsedBoards(context)) {
      const found = board.footprints.filter((footprint) => !footprint.dnp && isFiducial(footprint)).length;
      if (found < minimum) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.fiducials",
            severity: configuredSeverity(context, "manufacturing.fiducials", "medium"),
            message: `Assembly requires at least ${minimum} fiducials, found ${found}.`,
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
