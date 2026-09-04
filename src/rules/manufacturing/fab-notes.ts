import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { pathExists } from "../../util/fs.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const fabNotesRule = rule(
  {
    id: "manufacturing.fab-notes",
    title: "Fabrication notes are missing",
    description: "Checks known project paths for fabrication notes that travel with board outputs.",
    rationale: "Fabrication notes preserve process assumptions that output files alone do not encode.",
    defaultSeverity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.fab-notes.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["documentation", "fabrication", "manufacturing"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.fab-notes")) {
      return [];
    }
    const candidates = ["fab/README.md", "manufacturing/notes.md", "docs/fab-notes.md"];
    for (const candidate of candidates) {
      if (await pathExists(path.resolve(context.root, candidate))) {
        return [];
      }
    }
    return [
      finding(context, {
        ruleId: "manufacturing.fab-notes",
        severity: configuredSeverity(context, "manufacturing.fab-notes", "medium"),
        message: "Fabrication notes file was not found.",
        path: ".",
        kind: "manifest",
      }),
    ];
  },
);
