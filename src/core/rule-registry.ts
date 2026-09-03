import type { RuleContext } from "./context.js";
import type { Finding, Severity } from "./findings.js";

/**
 * What a rule protects against, grounded in this repo's own rule-group split
 * (`src/rules/{bom,design,drc,erc,firmware,manufacturing,pinmap,release}`) and the
 * "dfa"/"dfm" tags already used on manufacturing rules:
 * - "electrical": schematic/PCB/firmware-pin electrical correctness (DRC/ERC delegation,
 *   pinmap net checks, firmware pin contracts).
 * - "manufacturability" (DFM): whether the board/output package can be fabricated as designed.
 * - "assembly" (DFA): whether the board/BOM can be placed and assembled correctly.
 * - "testability" (DFT): in-circuit/functional test access.
 * - "sourcing": BOM supply-chain, compliance, and part-identity risk.
 * - "release": release process and traceability metadata.
 * - "unclassified": no classification is available (used only for rules loaded from a
 *   third-party plugin, whose `PluginRuleMetadata` contract does not yet carry this field).
 */
export type RuleCategory =
  | "electrical"
  | "manufacturability"
  | "assembly"
  | "testability"
  | "sourcing"
  | "release"
  | "unclassified";

/**
 * How a finding is derived:
 * - "exact": a deterministic presence/absence, equality, count, or membership check, or a
 *   normalized diagnostic delegated to an external tool (KiCad DRC/ERC).
 * - "heuristic": inferred from free-text pattern matching, naming/library conventions, or a
 *   weighted score, and can be legitimately overridden by a human's judgment.
 * - "unclassified": no classification is available (plugin-loaded rules only, see RuleCategory).
 */
export type RuleEvidenceType = "exact" | "heuristic" | "unclassified";

/**
 * How directly a user can resolve a finding raised by this rule:
 * - "manual": the finding names a concrete artifact/field to edit directly.
 * - "assisted": BoardReadyOps only normalizes an external tool's diagnostic (KiCad DRC/ERC);
 *   rules never edit KiCad files themselves, and the concrete remedy must be found in that tool.
 * - "none": the finding is informational/advisory, or an aggregate signal with no single
 *   corrective edit (fix the underlying findings, or accept the risk).
 * - "unclassified": no classification is available (plugin-loaded rules only, see RuleCategory).
 */
export type RuleFixability = "manual" | "assisted" | "none" | "unclassified";

/**
 * Whether a rule's pass/fail condition depends on manufacturer/CM capability data:
 * - "manufacturer-specific": resolves a named vendor profile (`src/vendor/profiles.ts`).
 * - "profile-specific": the threshold is a project-configured fabrication/assembly capability
 *   value that commonly varies by manufacturer, without a formal vendor profile lookup.
 * - "none": the check is manufacturer-agnostic.
 * - "unclassified": no classification is available (plugin-loaded rules only, see RuleCategory).
 */
export type RuleVendorDependence = "manufacturer-specific" | "profile-specific" | "none" | "unclassified";

export interface RuleMetadata {
  id: string;
  title: string;
  description: string;
  rationale: string;
  defaultSeverity: Severity;
  appliesTo: string[];
  configKeys: string[];
  kicadVersions: ("9" | "10" | "future")[];
  tags: string[];
  category: RuleCategory;
  evidenceType: RuleEvidenceType;
  fixability: RuleFixability;
  vendorDependence: RuleVendorDependence;
  docUrl?: string;
}

interface RuleExplanationSection {
  title: string;
  lines: string[];
}

export interface RuleExplanation {
  ruleId: string;
  summary: string;
  sections: RuleExplanationSection[];
}

interface RuleExplainer {
  explain(context: RuleContext): Promise<RuleExplanation>;
}

export interface Rule extends Partial<RuleExplainer> {
  meta: RuleMetadata;
  run(context: RuleContext): Promise<Finding[]>;
}

const registry = new Map<string, Rule>();

export function registerRule(rule: Rule): void {
  if (registry.has(rule.meta.id)) {
    throw new Error(`Duplicate rule id: ${rule.meta.id}`);
  }
  registry.set(rule.meta.id, rule);
}

export function listRules(): Rule[] {
  return [...registry.values()].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export function clearRulesForTests(): void {
  registry.clear();
}
