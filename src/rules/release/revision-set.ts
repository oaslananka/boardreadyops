import path from "node:path";
import { parsePcb } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const revisionSetRule = rule(
  {
    id: "release.revision-set",
    title: "PCB revision is missing",
    description: "Checks PCB title-block revisions against the configured release tag pattern.",
    rationale: "Boards without stable revisions are difficult to fabricate, review, and reproduce.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.release.revision-set.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["pcb", "release", "revision"],
  },
  async (context) => {
    if (!shouldRun(context, "release.revision-set")) {
      return [];
    }
    const output = [];
    const config = configFor(context, "release.revision-set");
    const tagPattern =
      typeof config["tag-pattern"] === "string" ? config["tag-pattern"] : "^v?\\d+\\.\\d+(?:\\.\\d+)?$";
    const revisionPattern = new RegExp(tagPattern);
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const parsed = await parsePcb(path.resolve(context.root, board));
        if (!parsed.revision) {
          output.push(
            finding(context, {
              ruleId: "release.revision-set",
              severity: configuredSeverity(context, "release.revision-set", "high"),
              message: "PCB title block revision is not set.",
              path: board,
              kind: "pcb",
            }),
          );
        } else if (!revisionPattern.test(parsed.revision) && !revisionPattern.test(`v${parsed.revision}`)) {
          output.push(
            finding(context, {
              ruleId: "release.revision-set",
              severity: configuredSeverity(context, "release.revision-set", "high"),
              message: `PCB title block revision ${parsed.revision} does not match tag pattern ${tagPattern}.`,
              path: board,
              kind: "pcb",
              details: { revision: parsed.revision, tagPattern },
            }),
          );
        }
      }
    }
    return output;
  },
);
