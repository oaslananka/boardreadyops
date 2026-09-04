import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

export const eolDetectionRule = rule(
  {
    id: "bom.eol-detection",
    title: "BOM part is marked EOL",
    description: "Checks lifecycle-style BOM fields for end-of-life and not-recommended markers.",
    rationale: "End-of-life components create sourcing and redesign risk before fabrication.",
    defaultSeverity: "high",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.eol-detection.severity"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "lifecycle", "sourcing"],
    ...RULE_CLASSIFICATIONS.sourcingHeuristic,
  },
  async (context) => {
    if (!shouldRun(context, "bom.eol-detection")) {
      return [];
    }
    const { bomRows } = await loadBomContext(context);
    return bomRows
      .filter((row) => !row.dnp && /(eol|obsolete|not recommended|nrnd)/i.test(row.lifecycle ?? ""))
      .map((row) =>
        finding(context, {
          ruleId: "bom.eol-detection",
          severity: configuredSeverity(context, "bom.eol-detection", "high"),
          message: `${row.reference} is marked ${row.lifecycle}.`,
          path: row.sourcePath,
          kind: "bom",
          line: row.line,
          details: { reference: row.reference, lifecycle: row.lifecycle, mpn: row.mpn },
        }),
      );
  },
);
