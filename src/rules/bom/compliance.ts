import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

const NON_COMPLIANT = /non[\s-]?compliant|not[\s-]?compliant|prohibited|restricted|\bfail/i;

export const complianceRule = rule(
  {
    id: "bom.compliance",
    title: "BOM component compliance is missing or failing",
    description: "Checks populated BOM components for RoHS/REACH compliance metadata.",
    rationale: "Non-compliant or undocumented parts create regulatory and shipment risk for the assembled product.",
    defaultSeverity: "high",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.compliance.enabled", "rules.bom.compliance.require", "rules.bom.compliance.severity"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "compliance", "rohs", "reach", "sourcing"],
    ...RULE_CLASSIFICATIONS.sourcingHeuristic,
  },
  async (context) => {
    if (!shouldRun(context, "bom.compliance")) {
      return [];
    }
    const config = configFor(context, "bom.compliance");
    if (config.enabled !== true) {
      return [];
    }
    const requireCompliance = config.require === true;
    const { bomRows } = await loadBomContext(context);
    const output = [];
    for (const row of bomRows) {
      if (row.dnp) {
        continue;
      }
      const status = row.compliance?.trim();
      if (!status) {
        if (requireCompliance) {
          output.push(
            finding(context, {
              ruleId: "bom.compliance",
              severity: configuredSeverity(context, "bom.compliance", "high"),
              message: `${row.reference} has no RoHS/REACH compliance data.`,
              path: row.sourcePath,
              kind: "bom",
              line: row.line,
              details: { reference: row.reference, mpn: row.mpn },
            }),
          );
        }
        continue;
      }
      if (NON_COMPLIANT.test(status)) {
        output.push(
          finding(context, {
            ruleId: "bom.compliance",
            severity: configuredSeverity(context, "bom.compliance", "high"),
            message: `${row.reference} is not compliant: ${status}.`,
            path: row.sourcePath,
            kind: "bom",
            line: row.line,
            details: { reference: row.reference, mpn: row.mpn, compliance: status },
          }),
        );
      }
    }
    return output;
  },
);
