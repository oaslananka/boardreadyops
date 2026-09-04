import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { parseJobset } from "../../kicad/jobset.js";
import { pathExists } from "../../util/fs.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const jobsetOutputsRule = rule(
  {
    id: "manufacturing.jobset-outputs",
    title: "Enabled KiCad jobset output is missing",
    description: "Checks enabled KiCad jobset entries for their expected output files.",
    rationale: "Jobset definitions are only useful when the released outputs they promise exist.",
    defaultSeverity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.jobset-outputs.enabled"],
    kicadVersions: ["10", "future"],
    tags: ["jobset", "kicad", "manufacturing"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.jobset-outputs")) {
      return [];
    }
    const output = [];
    for (const project of context.projects) {
      for (const jobset of project.jobsetFiles) {
        const parsed = await parseJobset(path.resolve(context.root, jobset));
        for (const job of parsed.jobs.filter((entry) => entry.enabled)) {
          const outputPath = (
            job.destinationPath ? path.join(job.destinationPath, job.outputPath) : job.outputPath
          ).replaceAll("\\", "/");
          const absoluteOutput = path.resolve(context.root, project.root, outputPath);
          if (!(await pathExists(absoluteOutput))) {
            output.push(
              finding(context, {
                ruleId: "manufacturing.jobset-outputs",
                severity: configuredSeverity(context, "manufacturing.jobset-outputs", "medium"),
                message: `Enabled ${job.type} jobset output ${outputPath} is missing.`,
                path: jobset,
                kind: "manifest",
                details: { type: job.type, outputPath },
              }),
            );
          }
        }
      }
    }
    return output;
  },
);
