/**
 * BOM risk scoring model.
 *
 * Provides per-component risk signals and an aggregate BOM risk summary.
 * Risk is driven by missing sourcing data (MPN, manufacturer, suppliers)
 * and supply-chain concentration (single source without approved alternates).
 *
 * The result types (`BomRiskSummary`, `BomComponentRisk`, `BomRiskFactors`,
 * `BomRiskLevel`) live in `src/core/bom-risk.ts` so that `RunResult` and
 * report modules can reference them without importing the `bom` layer.
 * The local types here are structurally compatible with those core interfaces.
 */

import { type BomRiskLevel, riskLevelFromScore } from "../util/risk-level.js";
import type { BomAlternate } from "./alternates.js";

// Local type aliases structurally compatible with the matching types in src/core/bom-risk.ts.
// Not exported — consumers should import from core/bom-risk.ts or via RunResult.
interface BomRiskFactors {
  missingMpn: boolean;
  missingManufacturer: boolean;
  noSuppliers: boolean;
  singleSourceNoAlternates: boolean;
}
interface BomComponentRiskLocal {
  reference: string;
  mpn?: string | undefined;
  manufacturer?: string | undefined;
  riskScore: number;
  riskLevel: BomRiskLevel;
  factors: BomRiskFactors;
  approvedAlternates?: BomAlternate[] | undefined;
}
interface BomRiskSummaryLocal {
  totalComponents: number;
  overallRiskScore: number;
  overallRiskLevel: BomRiskLevel;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  components: BomComponentRiskLocal[];
}

/** Configurable scoring weights for each risk factor (0–100 each). */
export interface BomRiskWeights {
  missingMpn: number;
  missingManufacturer: number;
  noSuppliers: number;
  singleSourceNoAlternates: number;
}

const DEFAULT_WEIGHTS: BomRiskWeights = {
  missingMpn: 60,
  missingManufacturer: 20,
  noSuppliers: 40,
  singleSourceNoAlternates: 25,
};

/**
 * Compute the risk assessment for a single BOM component.
 *
 * @param reference  Designator string (e.g. "R1")
 * @param mpn        Manufacturer part number, if any
 * @param manufacturer  Manufacturer name, if any
 * @param supplierCount  Number of supplier columns with values for this row
 * @param alternatesMap  Map of approved alternates keyed by upper-cased MPN
 * @param weights    Scoring weights to apply (defaults to DEFAULT_WEIGHTS)
 * @param bomHasSupplierColumns  Whether any row in the BOM has supplier data.
 *   When false the supplier-presence signals are N/A and are not scored —
 *   a BOM format that has no supplier columns at all is not penalised for it.
 */
export function computeComponentRisk(
  reference: string,
  mpn: string | undefined,
  manufacturer: string | undefined,
  supplierCount: number,
  alternatesMap: Map<string, BomAlternate[]>,
  weights: Partial<BomRiskWeights> = {},
  bomHasSupplierColumns = true,
): BomComponentRiskLocal {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const hasMpn = Boolean(mpn?.trim());
  const hasManufacturer = Boolean(manufacturer?.trim());
  const hasApprovedAlternates = hasMpn ? alternatesMap.has((mpn as string).trim().toUpperCase()) : false;
  const approvedAlternates = hasMpn ? alternatesMap.get((mpn as string).trim().toUpperCase()) : undefined;

  const supplierSignalsApply = bomHasSupplierColumns;
  const factors: BomRiskFactors = {
    missingMpn: !hasMpn,
    missingManufacturer: !hasManufacturer,
    noSuppliers: supplierSignalsApply && supplierCount === 0,
    singleSourceNoAlternates: supplierSignalsApply && supplierCount === 1 && !hasApprovedAlternates,
  };

  // Sum weighted penalties (clamped to 100)
  let rawScore = 0;
  if (factors.missingMpn) rawScore += w.missingMpn;
  if (factors.missingManufacturer) rawScore += w.missingManufacturer;
  if (factors.noSuppliers) rawScore += w.noSuppliers;
  else if (factors.singleSourceNoAlternates) rawScore += w.singleSourceNoAlternates;
  const riskScore = Math.min(100, rawScore);

  return {
    reference,
    mpn: mpn || undefined,
    manufacturer: manufacturer || undefined,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    factors,
    approvedAlternates,
  };
}

/**
 * Aggregate per-component risks into a single BOM-level risk summary.
 */
export function summarizeBomRisk(components: BomComponentRiskLocal[]): BomRiskSummaryLocal {
  const risky = components.filter((c) => c.riskLevel !== "none");

  const overallRiskScore =
    components.length === 0 ? 0 : Math.round(components.reduce((sum, c) => sum + c.riskScore, 0) / components.length);

  return {
    totalComponents: components.length,
    overallRiskScore,
    overallRiskLevel: riskLevelFromScore(overallRiskScore),
    criticalCount: risky.filter((c) => c.riskLevel === "critical").length,
    highCount: risky.filter((c) => c.riskLevel === "high").length,
    mediumCount: risky.filter((c) => c.riskLevel === "medium").length,
    lowCount: risky.filter((c) => c.riskLevel === "low").length,
    components,
  };
}
