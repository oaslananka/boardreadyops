/**
 * Lifecycle status abstraction for BOM components.
 *
 * Provides a canonical typed model for component lifecycle states so that
 * rules, reports, and future supplier plugins share a consistent vocabulary.
 * The model is designed to accept data from any source (BOM field, local
 * database, supplier plugin, manual config) without hard-coding a single
 * external provider.
 */

/**
 * Canonical lifecycle status values.
 *
 * - `active`   — in production, fully supported by the manufacturer
 * - `nrnd`     — Not Recommended for New Designs (may continue shipping)
 * - `obsolete` — discontinued / no longer manufactured or stocked
 * - `eol`      — End Of Life; imminent or confirmed production stop
 * - `unknown`  — no lifecycle data available from any source
 * - `custom`   — a raw value that does not map to a well-known status
 */
export type LifecycleStatus = "active" | "nrnd" | "obsolete" | "eol" | "unknown" | "custom";

/**
 * Origin of the lifecycle data for a component.
 *
 * - `bom-field`       — value came from a BOM column (e.g. "Lifecycle")
 * - `lifecycle-db`    — matched against a project-local JSON database file
 * - `supplier-plugin` — returned by a registered SupplierIntelligenceProvider
 * - `manual-config`   — hardcoded in boardreadyops.yml or an overlay config
 */
type LifecycleSourceType = "bom-field" | "lifecycle-db" | "supplier-plugin" | "manual-config";

/** Structured lifecycle metadata attached to a single component. */
export interface LifecycleMetadata {
  /** Canonical lifecycle status. */
  status: LifecycleStatus;
  /** Raw string value as it appeared in the data source (for display). */
  raw: string;
  /** Where the lifecycle data came from. */
  sourceType: LifecycleSourceType;
  /**
   * ISO-8601 timestamp when the data was fetched or last refreshed.
   * Absent when source is a static BOM field with no provenance timestamp.
   */
  fetchedAt?: string | undefined;
}

/** Risk level implied by a lifecycle status (higher = more concern). */
export type LifecycleRisk = "none" | "info" | "medium" | "high" | "critical";

/**
 * Map each canonical lifecycle status to a risk level.
 *
 * - `active`   → no risk
 * - `nrnd`     → medium (should be reviewed before next design cycle)
 * - `eol`      → high (active sourcing risk)
 * - `obsolete` → critical (cannot be ordered)
 * - `unknown`  → info (absence of data is itself a signal, not silence)
 * - `custom`   → info (unknown extended status; reviewer should inspect)
 */
export const LIFECYCLE_RISK: Record<LifecycleStatus, LifecycleRisk> = {
  active: "none",
  nrnd: "medium",
  eol: "high",
  obsolete: "critical",
  unknown: "info",
  custom: "info",
};

const EOL_PATTERNS = /\b(eol|end[\s-]of[\s-]life)\b/i;
const OBSOLETE_PATTERNS = /\b(obsolete|discontinued)\b/i;
const NRND_PATTERNS =
  /\b(nrnd|not[\s-]recommended(?:[\s-]for[\s-]new[\s-]design(?:s)?)?|preview|engineering[\s-]sample)\b/i;
const ACTIVE_PATTERNS = /\b(active|in[\s-]production|production)\b/i;

/**
 * Classify a raw lifecycle string into a canonical `LifecycleStatus`.
 *
 * Matching is case-insensitive and tolerates minor punctuation variants
 * (e.g. "end-of-life", "End Of Life", "EOL" all map to `"eol"`).
 * Empty / blank strings return `"unknown"`.
 */
export function classifyLifecycleStatus(raw: string | undefined | null): LifecycleStatus {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return "unknown";
  }
  if (EOL_PATTERNS.test(trimmed)) {
    return "eol";
  }
  if (OBSOLETE_PATTERNS.test(trimmed)) {
    return "obsolete";
  }
  if (NRND_PATTERNS.test(trimmed)) {
    return "nrnd";
  }
  if (ACTIVE_PATTERNS.test(trimmed)) {
    return "active";
  }
  return "custom";
}

/**
 * Build a `LifecycleMetadata` record from a BOM field value.
 */
export function lifecycleFromBomField(raw: string): LifecycleMetadata {
  return {
    status: classifyLifecycleStatus(raw),
    raw,
    sourceType: "bom-field",
  };
}

/**
 * Build a `LifecycleMetadata` record from a local lifecycle database entry.
 */
export function lifecycleFromDatabase(raw: string): LifecycleMetadata {
  return {
    status: classifyLifecycleStatus(raw),
    raw,
    sourceType: "lifecycle-db",
  };
}

/**
 * Aggregate lifecycle risk across a set of BOM components.
 * Returns counts per status and an overall worst-case risk level.
 */
export interface LifecycleSummary {
  activeCount: number;
  nrndCount: number;
  eolCount: number;
  obsoleteCount: number;
  unknownCount: number;
  customCount: number;
  /** Worst-case risk level across all non-active, non-unknown components. */
  worstRisk: LifecycleRisk;
}

const RISK_RANK: Record<LifecycleRisk, number> = {
  none: 0,
  info: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function buildLifecycleSummary(statuses: LifecycleStatus[]): LifecycleSummary {
  let activeCount = 0;
  let nrndCount = 0;
  let eolCount = 0;
  let obsoleteCount = 0;
  let unknownCount = 0;
  let customCount = 0;
  let worstRank = 0;

  for (const status of statuses) {
    if (status === "active") activeCount++;
    else if (status === "nrnd") nrndCount++;
    else if (status === "eol") eolCount++;
    else if (status === "obsolete") obsoleteCount++;
    else if (status === "unknown") unknownCount++;
    else customCount++;

    const rank = RISK_RANK[LIFECYCLE_RISK[status]];
    if (rank > worstRank) {
      worstRank = rank;
    }
  }

  const rankToRisk = (rank: number): LifecycleRisk => {
    for (const [riskLabel, r] of Object.entries(RISK_RANK) as [LifecycleRisk, number][]) {
      if (r === rank) return riskLabel;
    }
    return "none";
  };

  return {
    activeCount,
    nrndCount,
    eolCount,
    obsoleteCount,
    unknownCount,
    customCount,
    worstRisk: rankToRisk(worstRank),
  };
}
