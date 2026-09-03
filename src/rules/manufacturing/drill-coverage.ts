import path from "node:path";
import { parsePcb } from "../../kicad/pcb.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const drillCoverageRule = rule(
  {
    id: "manufacturing.drill-coverage",
    title: "Drill file does not cover PCB drill sizes",
    description: "Compares PCB drill sizes with generated Excellon drill outputs.",
    rationale: "Missing drill coverage can make a fabrication package incomplete or incorrect.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.drill-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["drill", "manufacturing", "pcb"],
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.drill-coverage")) {
      return [];
    }
    const drillFiles = await globFiles(context.root, ["**/*.drl"]);
    if (drillFiles.length === 0) {
      return [];
    }
    const drillText = (await Promise.all(drillFiles.map((file) => readTextFile(file).catch(() => "")))).join("\n");
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const parsed = await parsePcb(path.resolve(context.root, board));
        for (const size of parsed.drillSizes) {
          if (!drillText.includes(size)) {
            output.push(
              finding(context, {
                ruleId: "manufacturing.drill-coverage",
                severity: configuredSeverity(context, "manufacturing.drill-coverage", "medium"),
                message: `PCB drill size ${size} is not represented in drill outputs.`,
                path: board,
                kind: "pcb",
                details: { drillSize: size },
              }),
            );
          }
        }
      }
    }
    return output;
  },
);
