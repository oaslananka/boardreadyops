import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { parsePcb } from "../../kicad/pcb.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const tagMatchesRevisionRule = rule(
  {
    id: "release.tag-matches-revision",
    title: "Git tag does not match PCB revision",
    description: "Checks tag CI context against the board revision recorded in PCB metadata.",
    rationale: "Release tags should identify the exact board revision being fabricated.",
    defaultSeverity: "high",
    appliesTo: ["pcb", "manifest"],
    configKeys: ["GITHUB_REF_NAME"],
    kicadVersions: ["9", "10", "future"],
    tags: ["git", "release", "revision"],
    ...RULE_CLASSIFICATIONS.releasePresence,
  },
  async (context) => {
    if (!shouldRun(context, "release.tag-matches-revision")) {
      return [];
    }
    const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
    if (!tag) {
      return [];
    }
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const revision = (await parsePcb(path.resolve(context.root, board))).revision;
        if (!revision || (tag !== revision && tag !== `v${revision}`)) {
          output.push(
            finding(context, {
              ruleId: "release.tag-matches-revision",
              severity: configuredSeverity(context, "release.tag-matches-revision", "high"),
              message: revision
                ? `Tag ${tag} does not match board revision ${revision}.`
                : `Tag ${tag} cannot be matched because board revision is missing.`,
              path: board,
              kind: "pcb",
              details: { tag, revision },
            }),
          );
        }
      }
    }
    return output;
  },
);
