import type { RuleContext } from "../../core/context.js";
import { isSeverity } from "../../core/findings.js";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import type { kicadSeverityToFindingSeverity } from "../drc/severity-map.js";
import { configuredSeverity, rule, shouldRun } from "../helpers.js";
import { runKicadReportRule } from "../kicad-report.js";

export const runErcRule = rule(
  {
    id: "erc.kicad",
    title: "KiCad ERC findings",
    description: "Runs KiCad schematic electrical-rule checks and normalizes their diagnostics into findings.",
    rationale: "ERC diagnostics catch schematic connectivity and electrical intent problems early.",
    defaultSeverity: "high",
    appliesTo: ["schematic"],
    configKeys: ["kicad-cli", "require-kicad", "rules.erc"],
    kicadVersions: ["9", "10", "future"],
    tags: ["erc", "kicad", "schematic"],
    ...RULE_CLASSIFICATIONS.electricalDelegatedTool,
  },
  async (context) => {
    if (!shouldRun(context, "erc.kicad")) {
      return [];
    }
    return runKicadReportRule(context, {
      command: "erc",
      groupRuleId: "erc.kicad",
      unavailableRuleId: "erc.kicad-cli-unavailable",
      unavailableMessage: "kicad-cli not available, skipped ERC.",
      resourceKind: "schematic",
      files: (project) => project.schematicFiles,
      severity: ercSeverity,
    });
  },
);

function ercSeverity(
  context: RuleContext,
  kicadRule: string | undefined,
  fallback: ReturnType<typeof kicadSeverityToFindingSeverity>,
) {
  const groupRule = context.config.rules?.erc;
  if (kicadRule && typeof groupRule === "object" && groupRule !== null) {
    const override = groupRule["severity-overrides"]?.[kicadRule];
    if (isSeverity(override)) {
      return override;
    }
  }
  return configuredSeverity(context, "erc.kicad", fallback);
}
