import { buildAlternatesMap } from "../../bom/alternates.js";
import { type BomRiskWeights, computeComponentRisk, summarizeBomRisk } from "../../bom/risk.js";
import type { Severity } from "../../core/findings.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

export const bomRiskScoreRule = rule(
  {
    id: "bom.risk-score",
    title: "BOM component has elevated supply-chain risk",
    description:
      "Scores each populated BOM row on missing MPN, missing manufacturer, no suppliers, " +
      "and single-source-without-alternates signals. Emits a finding per at-risk component " +
      "so release readiness reflects aggregate BOM supply-chain quality.",
    rationale:
      "Individual per-row rules catch specific issues, but a scoring approach lets teams " +
      "set a single policy gate that blocks production releases when the overall BOM quality " +
      "falls below an acceptable threshold.",
    defaultSeverity: "medium",
    appliesTo: ["bom"],
    configKeys: [
      "rules.bom.risk-score.severity",
      "rules.bom.risk-score.critical-severity",
      "rules.bom.risk-score.high-severity",
      "rules.bom.risk-score.medium-severity",
      "rules.bom.risk-score.low-severity",
      "rules.bom.risk-score.weights.missing-mpn",
      "rules.bom.risk-score.weights.missing-manufacturer",
      "rules.bom.risk-score.weights.no-suppliers",
      "rules.bom.risk-score.weights.single-source-no-alternates",
      "bom.alternates",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "risk", "sourcing", "supply-chain"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.risk-score")) {
      return [];
    }

    const { bomRows } = await loadBomContext(context);
    if (bomRows.length === 0) {
      return [];
    }

    const config = configFor(context, "bom.risk-score");
    const weights = parseWeights(config);
    const alternatesMap = buildAlternatesMap(context.config.bom?.alternates ?? []);

    // Supplier signals are only meaningful when at least one BOM row has supplier
    // column data. A BOM format that has no supplier columns at all is not penalised.
    const bomHasSupplierColumns = bomRows.some((row) => (row.suppliers?.length ?? 0) > 0);

    const componentRisks = bomRows
      .filter((row) => !row.dnp)
      .map((row) =>
        computeComponentRisk(
          row.reference,
          row.mpn,
          row.manufacturer,
          row.suppliers?.filter(Boolean).length ?? 0,
          alternatesMap,
          weights,
          bomHasSupplierColumns,
        ),
      );

    const summary = summarizeBomRisk(componentRisks);

    return summary.components
      .filter((c) => c.riskLevel !== "none")
      .map((c) => {
        const level = c.riskLevel as "critical" | "high" | "medium" | "low";
        const resolvedSeverity = severityForLevel(level, config, context);
        const driverParts = buildDriverMessage(c.factors);
        const message =
          `${c.reference} has supply-chain risk (score ${c.riskScore}/100): ` + `${driverParts.join(", ")}.`;

        const row = bomRows.find((r) => r.reference === c.reference);
        return finding(context, {
          ruleId: "bom.risk-score",
          severity: resolvedSeverity,
          message,
          path: row?.sourcePath ?? bomRows[0]!.sourcePath,
          kind: "bom",
          line: row?.line,
          details: {
            reference: c.reference,
            mpn: c.mpn,
            manufacturer: c.manufacturer,
            riskScore: c.riskScore,
            riskLevel: c.riskLevel,
            factors: c.factors,
            overallBomRiskScore: summary.overallRiskScore,
            totalComponents: summary.totalComponents,
          },
        });
      });
  },
);

function parseWeights(config: Record<string, unknown>): Partial<BomRiskWeights> {
  const w = (config["weights"] ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const result: Partial<BomRiskWeights> = {};
  const missingMpn = num(w["missing-mpn"]);
  const missingManufacturer = num(w["missing-manufacturer"]);
  const noSuppliers = num(w["no-suppliers"]);
  const singleSourceNoAlternates = num(w["single-source-no-alternates"]);
  if (missingMpn !== undefined) result.missingMpn = missingMpn;
  if (missingManufacturer !== undefined) result.missingManufacturer = missingManufacturer;
  if (noSuppliers !== undefined) result.noSuppliers = noSuppliers;
  if (singleSourceNoAlternates !== undefined) result.singleSourceNoAlternates = singleSourceNoAlternates;
  return result;
}

function severityForLevel(
  level: "critical" | "high" | "medium" | "low",
  config: Record<string, unknown>,
  context: Parameters<typeof configuredSeverity>[0],
): Severity {
  const configKey = `${level}-severity`;
  const raw = config[configKey];
  if (typeof raw === "string" && isSeverity(raw)) {
    return raw;
  }
  return configuredSeverity(context, "bom.risk-score", "medium");
}

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
function isSeverity(v: string): v is Severity {
  return SEVERITIES.has(v);
}

function buildDriverMessage(factors: {
  missingMpn: boolean;
  missingManufacturer: boolean;
  noSuppliers: boolean;
  singleSourceNoAlternates: boolean;
}): string[] {
  const parts: string[] = [];
  if (factors.missingMpn) parts.push("no MPN");
  if (factors.missingManufacturer) parts.push("no manufacturer");
  if (factors.noSuppliers) parts.push("no suppliers");
  else if (factors.singleSourceNoAlternates) parts.push("single source, no approved alternates");
  return parts;
}
