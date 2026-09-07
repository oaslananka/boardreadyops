import catalog from "./rule-catalog.json" with { type: "json" };

/**
 * The rules the engine runs, as data.
 *
 * `apps/web` does not depend on the rule engine -- its workspace dependencies are the cloud
 * packages only -- so the registry cannot be imported here without dragging the whole engine into
 * the Next bundle. `scripts/generate-rule-docs.mjs` writes `rule-catalog.json` from the same
 * registry it writes the reference pages from, and `rule-catalog.test.ts` fails when the two
 * disagree.
 */

export type RuleSeverity = "critical" | "high" | "medium" | "low" | "info";

export type RuleCategory =
  | "electrical"
  | "manufacturability"
  | "assembly"
  | "testability"
  | "sourcing"
  | "release"
  | "unclassified";

export type CatalogRule = {
  id: string;
  title: string;
  description: string;
  rationale: string;
  defaultSeverity: RuleSeverity;
  category: RuleCategory;
  appliesTo: readonly string[];
  configKeys: readonly string[];
  tags: readonly string[];
  /** How the finding is established: a parsed fact, a tool's own diagnostic, or a heuristic. */
  evidenceType: string;
  fixability: string;
  vendorDependence: string;
};

export const catalogRules = catalog.rules as readonly CatalogRule[];

/** Severity order for display: worst first, matching how findings are ranked everywhere else. */
const severityRank: Record<RuleSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export type RuleFilters = {
  query?: string | undefined;
  category?: RuleCategory | undefined;
  severity?: RuleSeverity | undefined;
};

const categories = new Set<RuleCategory>([
  "electrical",
  "manufacturability",
  "assembly",
  "testability",
  "sourcing",
  "release",
  "unclassified",
]);

const severities = new Set<RuleSeverity>(["critical", "high", "medium", "low", "info"]);

/** Parses an untrusted `?category=`, so a hand-edited URL cannot produce a filter nothing matches. */
export function parseRuleCategory(value: string | undefined): RuleCategory | undefined {
  const normalized = value?.trim().toLowerCase() as RuleCategory | undefined;
  return normalized && categories.has(normalized) ? normalized : undefined;
}

export function parseRuleSeverity(value: string | undefined): RuleSeverity | undefined {
  const normalized = value?.trim().toLowerCase() as RuleSeverity | undefined;
  return normalized && severities.has(normalized) ? normalized : undefined;
}

/**
 * Filters and orders the catalogue. Severity first, then id, so the list reads as "what would
 * block a release" rather than as an alphabet.
 */
export function filterRules(filters: RuleFilters = {}, rules: readonly CatalogRule[] = catalogRules): CatalogRule[] {
  const query = filters.query?.trim().toLowerCase();

  return rules
    .filter((rule) => {
      if (filters.category && rule.category !== filters.category) return false;
      if (filters.severity && rule.defaultSeverity !== filters.severity) return false;
      if (!query) return true;
      // Tags and config keys are searched too: someone looking for "rohs" or for the key they saw
      // in a boardreadyops.yml should land on the rule either way.
      return [rule.id, rule.title, rule.description, ...rule.tags, ...rule.configKeys].some((field) =>
        field.toLowerCase().includes(query),
      );
    })
    .sort(
      (left, right) =>
        severityRank[left.defaultSeverity] - severityRank[right.defaultSeverity] || left.id.localeCompare(right.id),
    );
}

/** Counts per category, for the filter chips to state how much each one holds. */
export function ruleCountsByCategory(rules: readonly CatalogRule[] = catalogRules): Map<RuleCategory, number> {
  const counts = new Map<RuleCategory, number>();
  for (const rule of rules) counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);
  return counts;
}
