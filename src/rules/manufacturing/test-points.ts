import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { isTestPoint, parsedBoards, positiveInteger } from "./shared.js";

export const testPointsRule = rule(
  {
    id: "manufacturing.test-points",
    title: "Test points are missing",
    description: "Checks for a configured minimum number of test point footprints for in-circuit or functional test.",
    rationale: "Accessible test points let assembly and QA validate power and key nets without reworking the board.",
    defaultSeverity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.test-points.enabled", "rules.manufacturing.test-points.minimum"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "manufacturing", "pcb", "test"],
    category: "testability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.test-points")) {
      return [];
    }
    const config = configFor(context, "manufacturing.test-points");
    if (config.enabled !== true) {
      return [];
    }
    const minimum = positiveInteger(config.minimum, 1);
    const output = [];
    for (const board of await parsedBoards(context)) {
      const found = board.footprints.filter((footprint) => !footprint.dnp && isTestPoint(footprint)).length;
      if (found < minimum) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.test-points",
            severity: configuredSeverity(context, "manufacturing.test-points", "low"),
            message: `Assembly test coverage requires at least ${minimum} test point(s), found ${found}.`,
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
