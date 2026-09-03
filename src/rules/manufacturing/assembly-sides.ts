import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { assemblyFootprints, footprintSide, parsedBoards } from "./shared.js";

export const assemblySidesRule = rule(
  {
    id: "manufacturing.assembly-sides",
    title: "Bottom-side assembly components",
    description: "Reports assembly components placed on the bottom copper layer.",
    rationale:
      "Bottom-side placement adds a second assembly pass and stencil; flag it when single-side assembly is expected.",
    defaultSeverity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.assembly-sides.enabled", "rules.manufacturing.assembly-sides.allow-bottom-side"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "manufacturing", "pcb"],
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.assembly-sides")) {
      return [];
    }
    const config = configFor(context, "manufacturing.assembly-sides");
    if (config.enabled !== true || config["allow-bottom-side"] === true) {
      return [];
    }
    const output = [];
    for (const board of await parsedBoards(context)) {
      const bottom = assemblyFootprints(board.footprints).filter((footprint) => footprintSide(footprint) === "bottom");
      if (bottom.length > 0) {
        const references = bottom
          .map((footprint) => footprint.reference)
          .sort((left, right) => left.localeCompare(right));
        output.push(
          finding(context, {
            ruleId: "manufacturing.assembly-sides",
            severity: configuredSeverity(context, "manufacturing.assembly-sides", "low"),
            message: `${bottom.length} assembly component(s) are on the bottom side: ${references.join(", ")}.`,
            path: board.path,
            kind: "pcb",
            details: { bottomSideCount: bottom.length, references },
          }),
        );
      }
    }
    return output;
  },
);
