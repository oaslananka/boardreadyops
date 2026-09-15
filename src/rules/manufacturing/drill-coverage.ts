import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { parsePcb } from "../../kicad/pcb.js";
import { parseExcellon } from "../../multicad/excellon-parser.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

/**
 * Drill diameters differing by less than this are the same tool, in millimetres.
 *
 * One micron absorbs the rounding a CAM exporter applies when it writes `T01C0.400` for a
 * `(drill 0.4)`, without merging genuinely different tools: real drill sizes are separated by
 * 0.05 mm at the very least.
 */
const diameterToleranceMm = 0.001;

export const drillCoverageRule = rule(
  {
    id: "manufacturing.drill-coverage",
    title: "Drill file does not cover PCB drill sizes",
    description: "Compares PCB drill sizes with the tool diameters declared in the Excellon outputs.",
    rationale: "Missing drill coverage can make a fabrication package incomplete or incorrect.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.drill-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["drill", "manufacturing", "pcb"],
    // Reclassified from manufacturabilityCapabilityThreshold. This is a self-consistency check
    // between a board and its own outputs, with no manufacturer capability involved -- calling it
    // profile-specific implied a vendor threshold that was never consulted.
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.drill-coverage")) {
      return [];
    }
    const drillFiles = await globFiles(context.root, ["**/*.drl"]);
    if (drillFiles.length === 0) {
      return [];
    }

    // Tool diameters, read from the tool table rather than matched as text. The previous version
    // asked whether the drill file's raw text `includes` the PCB's drill size, which is wrong in
    // both directions: "0.4" is a substring of the coordinate `X10.45`, so a missing tool passed,
    // and a board writing "0.40" against a file writing "0.4" failed for no reason.
    //
    // Tool diameters survive an unknown coordinate format, because Excellon writes them with an
    // explicit decimal point (`T01C0.400`). So this comparison stays exact even on a file whose
    // coordinates the parser had to guess.
    const diameters: number[] = [];
    for (const file of drillFiles) {
      const text = await readTextFile(file).catch(() => "");
      if (!text) continue;
      diameters.push(...parseExcellon(text, path.relative(context.root, file)).tools.map((tool) => tool.diameterMm));
    }

    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const parsed = await parsePcb(path.resolve(context.root, board));
        for (const size of parsed.drillSizes) {
          const wanted = Number(size);
          if (!Number.isFinite(wanted) || wanted <= 0) continue;
          if (diameters.some((diameter) => Math.abs(diameter - wanted) <= diameterToleranceMm)) continue;

          const nearest = nearestDiameter(diameters, wanted);
          output.push(
            finding(context, {
              ruleId: "manufacturing.drill-coverage",
              severity: configuredSeverity(context, "manufacturing.drill-coverage", "medium"),
              message:
                nearest === undefined
                  ? `PCB drill size ${size} mm has no matching tool in the drill outputs.`
                  : `PCB drill size ${size} mm has no matching tool in the drill outputs; the nearest is ${nearest} mm.`,
              path: board,
              kind: "pcb",
              details: {
                drillSize: size,
                ...(nearest === undefined ? {} : { nearestToolMm: nearest }),
                toolsFound: diameters.length,
              },
            }),
          );
        }
      }
    }
    return output;
  },
);

/** The closest tool diameter, so the finding says what the package does contain. */
function nearestDiameter(diameters: readonly number[], wanted: number): number | undefined {
  let best: number | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const diameter of diameters) {
    const gap = Math.abs(diameter - wanted);
    if (gap < bestGap) {
      bestGap = gap;
      best = diameter;
    }
  }
  return best;
}
