import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { assemblyFootprints, parsedBoards } from "./shared.js";

const SMD_FOOTPRINT_PATTERN = /smd|0402|0201|0603|0805|1206|sot-23|soic|qfp|qfn|bga|tssop|ssop|msop/i;

/**
 * Returns an estimate of whether a footprint is an SMD (surface-mount) component.
 * Based on footprint name conventions used in KiCad standard libraries.
 */
function isSmdFootprint(footprint: string): boolean {
  return SMD_FOOTPRINT_PATTERN.test(footprint);
}

export const silkscreenOverPadRule = rule(
  {
    id: "manufacturing.dfm-silkscreen-over-pad",
    title: "Dense SMD board: verify silkscreen does not overlap pads",
    description:
      "Flags boards with a high density of SMD components as a reminder to verify that silkscreen markings do not overlap solder pads.",
    rationale:
      "Silkscreen ink on solder pads can cause poor solder joints and tombstoning. Dense SMD layouts are particularly at risk. KiCad DRC includes a silkscreen clearance check that should be enabled for production boards.",
    defaultSeverity: "info",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.dfm-silkscreen-over-pad.minimum-smd-count"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "dfm", "manufacturing", "pcb", "silkscreen"],
    ...RULE_CLASSIFICATIONS.manufacturabilityHeuristicAdvisory,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.dfm-silkscreen-over-pad")) {
      return [];
    }
    const config = configFor(context, "manufacturing.dfm-silkscreen-over-pad");
    if (config.enabled !== true) {
      return [];
    }
    const minimumSmdCount = typeof config["minimum-smd-count"] === "number" ? config["minimum-smd-count"] : 10;
    const output = [];
    for (const board of await parsedBoards(context)) {
      const assembly = assemblyFootprints(board.footprints);
      const smdCount = assembly.filter((fp) => isSmdFootprint(fp.footprint)).length;
      if (smdCount >= minimumSmdCount) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.dfm-silkscreen-over-pad",
            severity: configuredSeverity(context, "manufacturing.dfm-silkscreen-over-pad", "info"),
            message: `Board has ${smdCount} SMD components. Verify that silkscreen markings do not overlap solder pads before ordering.`,
            path: board.path,
            kind: "pcb",
            fix: {
              description:
                "Enable the 'Silkscreen clipped by solder mask' and 'Silkscreen on solder mask' DRC rules in KiCad and run DRC before generating Gerbers. Adjust component courtyard and silkscreen layers to clear pad areas.",
            },
            details: { smdCount, minimumSmdCount },
          }),
        );
      }
    }
    return output;
  },
);
