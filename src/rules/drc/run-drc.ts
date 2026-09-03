import type { RuleContext } from "../../core/context.js";
import { isSeverity } from "../../core/findings.js";
import { configuredSeverity, rule, shouldRun } from "../helpers.js";
import { runKicadReportRule } from "../kicad-report.js";
import type { kicadSeverityToFindingSeverity } from "./severity-map.js";

export const runDrcRule = rule(
  {
    id: "drc.kicad",
    title: "KiCad DRC findings",
    description: "Runs KiCad PCB design-rule checks and normalizes their diagnostics into findings.",
    rationale: "KiCad DRC findings expose layout violations that should be reviewed before fabrication.",
    defaultSeverity: "high",
    appliesTo: ["pcb"],
    configKeys: ["kicad-cli", "require-kicad", "rules.drc"],
    kicadVersions: ["9", "10", "future"],
    tags: ["drc", "kicad", "pcb"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "assisted",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "drc.kicad")) {
      return [];
    }
    return runKicadReportRule(context, {
      command: "drc",
      groupRuleId: "drc.kicad",
      unavailableRuleId: "drc.kicad-cli-unavailable",
      unavailableMessage: "kicad-cli not available, skipped DRC.",
      resourceKind: "pcb",
      files: (project) => project.boardFiles,
      severity: drcSeverity,
    });
  },
);

function drcSeverity(
  context: RuleContext,
  kicadRule: string | undefined,
  fallback: ReturnType<typeof kicadSeverityToFindingSeverity>,
) {
  const groupRule = context.config.rules?.drc;
  if (kicadRule && typeof groupRule === "object" && groupRule !== null) {
    const override = groupRule["severity-overrides"]?.[kicadRule];
    if (isSeverity(override)) {
      return override;
    }
  }
  return configuredSeverity(context, "drc.kicad", fallback);
}
