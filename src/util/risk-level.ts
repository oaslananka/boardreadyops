/** Risk level derived from a weighted score in the range 0–100. */
export type BomRiskLevel = "critical" | "high" | "medium" | "low" | "none";

/**
 * Map a 0–100 risk score to a discrete BomRiskLevel.
 * Thresholds: ≥60 → critical, ≥40 → high, ≥20 → medium, >0 → low, 0 → none.
 */
export function riskLevelFromScore(score: number): BomRiskLevel {
  if (score === 0) return "none";
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}
