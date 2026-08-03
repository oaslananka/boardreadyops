import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { parsePcb } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, refIgnored, rule, shouldRun } from "../helpers.js";

export const uniqueReferencesRule = rule(
  {
    id: "design.unique-references",
    title: "Duplicate reference designators",
    description: "Flags board footprints that share a reference designator.",
    rationale: "Duplicate reference designators make BOM, placement, and assembly mapping ambiguous.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["rules.design.unique-references.enabled", "rules.design.unique-references.ignore-refs"],
    kicadVersions: ["9", "10", "future"],
    tags: ["design", "dfm", "pcb"],
  },
  async (context) => {
    if (!shouldRun(context, "design.unique-references")) {
      return [];
    }
    const config = configFor(context, "design.unique-references");
    if (config.enabled !== true) {
      return [];
    }
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        output.push(...(await checkBoardUniqueReferences(context, board, config)));
      }
    }
    return output;
  },
);

async function checkBoardUniqueReferences(context: RuleContext, board: string, config: Record<string, unknown>) {
  const output = [];
  const parsed = await parsePcb(path.resolve(context.root, board));
  const counts = new Map<string, number>();
  for (const footprint of parsed.footprints) {
    if (refIgnored(footprint.reference, config["ignore-refs"])) {
      continue;
    }
    const key = footprint.reference.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [reference, count] of [...counts].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (count > 1) {
      output.push(
        finding(context, {
          ruleId: "design.unique-references",
          severity: configuredSeverity(context, "design.unique-references", "high"),
          message: `Reference designator ${reference} is used ${count} times; designators must be unique.`,
          path: board,
          kind: "pcb",
          details: { reference, count },
        }),
      );
    }
  }
  return output;
}
