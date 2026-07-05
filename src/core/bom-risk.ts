/**
 * BOM supply-chain risk result types and summary reconstruction.
 *
 * Lives in `core` so that `RunResult` and report modules can reference the
 * BOM risk shape without importing the `bom` layer. The computation functions
 * (`computeComponentRisk`, `summarizeBomRisk`) stay in `src/bom/risk.ts`.
 * This module only holds types and a pure reconstructor that reads from
 * finding details — no dependency on any `bom` module.
 */

import { type BomRiskLevel, riskLevelFromScore } from "../util/risk-level.js";

/** Individual risk factors that contribute to a component's risk score. */
interface BomRiskFactors {
  missingMpn: boolean;
  missingManufacturer: boolean;
  noSuppliers: boolean;
  singleSourceNoAlternates: boolean;
}

/** Per-component risk assessment attached to the run result. */
interface BomComponentRisk {
  reference: string;
  mpn?: string | undefined;
  manufacturer?: string | undefined;
  /** Numeric risk score in the range 0–100 (higher = riskier). */
  riskScore: number;
  riskLevel: BomRiskLevel;
  factors: BomRiskFactors;
}

/** Aggregate BOM supply-chain risk across all populated components. */
export interface BomRiskSummary {
  /** Total populated (non-DNP) components evaluated. */
  totalComponents: number;
  /**
   * Composite BOM risk score in the range 0–100.
   * Computed as the average of per-component risk scores.
   */
  overallRiskScore: number;
  /** Aggregate risk level derived from overallRiskScore. */
  overallRiskLevel: BomRiskLevel;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  /** Per-component risk breakdowns. */
  components: BomComponentRisk[];
}

const RISK_LEVELS = new Set<BomRiskLevel>(["critical", "high", "medium", "low", "none"]);
function isRiskLevel(v: unknown): v is BomRiskLevel {
  return typeof v === "string" && RISK_LEVELS.has(v as BomRiskLevel);
}

/**
 * Reconstruct a `BomRiskSummary` from `bom.risk-score` finding details.
 *
 * Called by the pipeline to attach the summary to `RunResult` without
 * re-running rule logic. Returns `undefined` when no relevant findings exist.
 */
export function bomRiskSummaryFromFindings(
  findings: ReadonlyArray<{
    ruleId: string;
    details?: Record<string, unknown> | undefined;
  }>,
): BomRiskSummary | undefined {
  const riskFindings = findings.filter((f) => f.ruleId === "bom.risk-score" && f.details);
  if (riskFindings.length === 0) {
    return undefined;
  }

  const firstDetails = riskFindings[0]?.details ?? {};
  const totalComponents =
    typeof firstDetails.totalComponents === "number" ? firstDetails.totalComponents : riskFindings.length;
  const overallRiskScore = typeof firstDetails.overallBomRiskScore === "number" ? firstDetails.overallBomRiskScore : 0;

  const components: BomComponentRisk[] = riskFindings.map((f) => {
    const d = f.details ?? {};
    const factors = (d.factors ?? {}) as BomRiskFactors;
    return {
      reference: String(d.reference ?? ""),
      mpn: typeof d.mpn === "string" ? d.mpn : undefined,
      manufacturer: typeof d.manufacturer === "string" ? d.manufacturer : undefined,
      riskScore: typeof d.riskScore === "number" ? d.riskScore : 0,
      riskLevel: isRiskLevel(d.riskLevel) ? d.riskLevel : "none",
      factors,
    };
  });

  return {
    totalComponents,
    overallRiskScore,
    overallRiskLevel: riskLevelFromScore(overallRiskScore),
    criticalCount: components.filter((c) => c.riskLevel === "critical").length,
    highCount: components.filter((c) => c.riskLevel === "high").length,
    mediumCount: components.filter((c) => c.riskLevel === "medium").length,
    lowCount: components.filter((c) => c.riskLevel === "low").length,
    components,
  };
}
