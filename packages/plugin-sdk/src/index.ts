/** Supported finding severities emitted by plugin rules. */
export type PluginSeverity = "critical" | "high" | "medium" | "low" | "info";

/** Confidence levels a plugin can attach to a finding. */
export type PluginConfidenceLevel = "definite" | "high" | "medium" | "low";

/** Human-readable remediation guidance for a plugin finding. */
export interface PluginFixSuggestion {
  description: string;
  steps?: string[] | undefined;
  references?: string[] | undefined;
  automated?: boolean | undefined;
}

/** A finding emitted by a plugin rule against a project resource. */
export interface PluginFinding {
  ruleId: string;
  severity: PluginSeverity;
  message: string;
  project?: string | undefined;
  resource: {
    path: string;
    kind: "project" | "schematic" | "pcb" | "bom" | "pinmap" | "manifest";
  };
  location?:
    | {
        line?: number | undefined;
        column?: number | undefined;
        region?: {
          startLine: number;
          endLine: number;
          startColumn?: number | undefined;
          endColumn?: number | undefined;
        };
        boardCoordinates?: {
          x: number;
          y: number;
          layer?: string | undefined;
          units: "mm" | "in";
        };
      }
    | undefined;
  details?: Record<string, unknown> | undefined;
  references?: string[] | undefined;
  fix?: PluginFixSuggestion | undefined;
  confidence?: PluginConfidenceLevel | undefined;
  fingerprint?: string | undefined;
  suppressed?: boolean | undefined;
}

/** Metadata that registers and documents a plugin rule. */
export interface PluginRuleMetadata {
  id: string;
  title: string;
  description: string;
  rationale: string;
  defaultSeverity: PluginSeverity;
  appliesTo: string[];
  configKeys: string[];
  kicadVersions: ("9" | "10" | "future")[];
  tags: string[];
  docUrl?: string;
}

/** File discovery context for one KiCad project in the active workspace. */
export interface PluginProjectContext {
  projectFile: string;
  root: string;
  schematicFiles: string[];
  boardFiles: string[];
  jobsetFiles: string[];
}

/** Structured logger exposed to plugins during rule execution. */
export interface PluginLogger {
  /** Emit development diagnostics for a plugin execution event. */
  debug(event: string, data?: Record<string, unknown>): void;
  /** Emit an informational plugin execution event. */
  info(event: string, data?: Record<string, unknown>): void;
  /** Emit a recoverable plugin execution warning. */
  warn(event: string, data?: Record<string, unknown>): void;
  /** Emit an unrecoverable plugin execution error. */
  error(event: string, data?: Record<string, unknown>): void;
}

/** Execution context passed to each plugin rule. */
export interface PluginRuleContext {
  root: string;
  projects: PluginProjectContext[];
  config: unknown;
  options: Record<string, unknown>;
  logger: PluginLogger;
}

/** Runtime rule implementation contributed by a plugin. */
export interface Rule {
  meta: PluginRuleMetadata;
  /** Inspect the project context and return findings for this rule. */
  run(context: PluginRuleContext): PluginFinding[] | Promise<PluginFinding[]>;
}

/** Component adapter extension point reserved for plugin packages. */
export interface ComponentAdapter {
  id: string;
  [key: string]: unknown;
}

/** Report emitter extension point reserved for plugin packages. */
export interface ReportEmitter {
  id: string;
  [key: string]: unknown;
}

/** Vendor profile extension point reserved for plugin packages. */
export interface VendorProfile {
  id: string;
  [key: string]: unknown;
}

/** Notification extension point reserved for plugin packages. */
export interface Notifier {
  id: string;
  [key: string]: unknown;
}

/** Lifecycle status for a component part number from a supplier intelligence provider. */
export type SupplierLifecycleStatus = "active" | "nrnd" | "last-time-buy" | "eol" | "obsolete" | "unknown";

/** Trust level of the data returned by a supplier intelligence provider. */
export type SupplierDataTrust = "verified" | "estimated" | "unverified" | "unknown";

/** Per-component intelligence record returned by a supplier provider. */
export interface SupplierIntelligenceRecord {
  /** The MPN this record covers. */
  mpn: string;
  /** Manufacturer name, if known. */
  manufacturer?: string | undefined;
  /** Part lifecycle status from the supplier or distributor. */
  lifecycleStatus?: SupplierLifecycleStatus | undefined;
  /** Number of known active distributors stocking this part. */
  supplierCount?: number | undefined;
  /** Whether the part is currently available (sufficient stock for the project). */
  available?: boolean | undefined;
  /** Approved or known alternate MPNs that can substitute this part. */
  alternates?: string[] | undefined;
  /** Whether the part is on any regulatory restricted substances list. */
  restrictedSubstances?: boolean | undefined;
  /** Compliance notes (e.g. RoHS, REACH, ECCN). */
  complianceNotes?: string[] | undefined;
  /** Indicative lead time in weeks at query time. */
  leadTimeWeeks?: number | undefined;
  /** Free-form notes from the provider. */
  notes?: string | undefined;
  /** ISO 8601 timestamp when this record was last fetched or updated. */
  fetchedAt?: string | undefined;
  /** Trust level of the data in this record. */
  trust?: SupplierDataTrust | undefined;
}

/** Input passed to a supplier intelligence provider when querying component data. */
export interface SupplierIntelligenceQuery {
  /** Components to look up; each entry has at minimum a reference and optionally mpn/manufacturer. */
  components: Array<{
    reference: string;
    mpn?: string | undefined;
    manufacturer?: string | undefined;
  }>;
  /** Optional project root path (read-only access). */
  projectRoot?: string | undefined;
}

/** Result returned by a supplier intelligence provider. */
export interface SupplierIntelligenceResult {
  /** Per-component records, keyed by MPN. */
  records: Map<string, SupplierIntelligenceRecord>;
  /** Provider-level warnings (e.g. API rate limit, partial data, freshness). */
  warnings?: string[] | undefined;
  /** ISO 8601 timestamp when the query was executed. */
  queriedAt?: string | undefined;
}

/** Supplier intelligence provider extension point for plugins. */
export interface SupplierIntelligenceProvider {
  id: string;
  name: string;
  /** True when this provider requires network access. */
  requiresNetwork?: boolean | undefined;
  /** Fetch supplier intelligence for the given components. */
  query(input: SupplierIntelligenceQuery): Promise<SupplierIntelligenceResult>;
}

/** Runtime capabilities a plugin asks the host to approve before loading. */
export type PluginPermission = "fs:read" | "fs:write" | "network" | "process" | "kicad-cli";

/**
 * Compatibility constraint declared by a plugin or rule pack.
 *
 * Used to ensure that packs are only loaded by compatible BoardReadyOps host
 * versions and against compatible KiCad projects.
 */
export interface CompatibilityConstraints {
  /** Minimum BoardReadyOps semver (inclusive), e.g. "1.8.0". */
  boardreadyopsMin?: string | undefined;
  /** Maximum BoardReadyOps semver (exclusive), e.g. "3.0.0". */
  boardreadyopsMax?: string | undefined;
  /** KiCad major versions that this pack supports. */
  kicadVersions?: ("9" | "10" | "future")[] | undefined;
}

/**
 * Per-rule configuration override declared inside a rule pack.
 *
 * Consumers can enable/disable rules, override severity, and set config keys
 * without writing their own boardreadyops.yml rule overrides.
 */
export interface RulePackRuleOverride {
  enabled?: boolean | undefined;
  severity?: "critical" | "high" | "medium" | "low" | "info" | undefined;
  [configKey: string]: unknown;
}

/**
 * A rule pack: a named, versioned bundle of rule configuration presets.
 *
 * Rule packs are not full plugins — they do not ship rule implementations.
 * Instead they layer on top of the built-in or plugin-contributed rule set
 * by enabling/disabling rules and setting configuration defaults suited to
 * a specific release context (prototype, production, open-hardware, etc.).
 *
 * Rule packs can be distributed as npm packages or as local YAML files.
 * The host merges rule overrides in pack order (later entries win).
 */
export interface RulePackManifest {
  /** Unique reverse-DNS-style pack identifier. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semver version string. */
  version: string;
  /** One-line description shown in `boardreadyops doctor` output. */
  description: string;
  /** Who authored or maintains this pack. */
  author?: string | undefined;
  /** SPDX license expression. */
  license?: string | undefined;
  /** URL to the pack homepage, repository, or registry entry. */
  homepage?: string | undefined;
  /**
   * Category tags used for discovery in the marketplace or CLI.
   * Examples: "prototype", "production", "open-hardware", "automotive", "iec-62443"
   */
  tags?: string[] | undefined;
  /** Compatibility constraints the host must check before loading. */
  compatibility?: CompatibilityConstraints | undefined;
  /**
   * Rule configuration overrides applied when the pack is active.
   *
   * Keys are rule IDs (e.g. "bom.missing-mpn"). The value is a boolean
   * (true = enable, false = disable) or a RulePackRuleOverride object.
   */
  rules?: Record<string, boolean | RulePackRuleOverride> | undefined;
  /**
   * Vendor profile ID to activate when this pack is used.
   * Must match a built-in or plugin-contributed vendor profile ID.
   */
  vendorProfile?: string | undefined;
  /**
   * Release mode to enforce when this pack is active.
   * Overrides the project-level releaseMode.
   */
  releaseMode?: "prototype" | "pilot" | "production" | undefined;
}

/** Top-level plugin export consumed by BoardReadyOps plugin loading. */
export interface BoardReadyOpsPlugin {
  name: string;
  version: string;
  permissions?: PluginPermission[] | undefined;
  compatibility?: CompatibilityConstraints | undefined;
  rules?: Rule[] | undefined;
  adapters?: ComponentAdapter[] | undefined;
  reportFormats?: ReportEmitter[] | undefined;
  vendorProfiles?: VendorProfile[] | undefined;
  notifiers?: Notifier[] | undefined;
  /** Supplier intelligence providers contributed by this plugin. */
  supplierProviders?: SupplierIntelligenceProvider[] | undefined;
  /** Rule packs contributed by this plugin. */
  rulePacks?: RulePackManifest[] | undefined;
}

/**
 * Returns a plugin definition with its public type checked at authoring time.
 *
 * @example
 * ```ts
 * import { definePlugin } from "@boardreadyops/plugin-sdk";
 *
 * export default definePlugin({
 *   name: "boardreadyops-plugin-example",
 *   version: "1.0.0",
 *   rules: [],
 * });
 * ```
 */
export function definePlugin(plugin: BoardReadyOpsPlugin): BoardReadyOpsPlugin {
  return plugin;
}

/**
 * Returns a rule pack manifest with its public type checked at authoring time.
 *
 * @example
 * ```ts
 * import { defineRulePack } from "@boardreadyops/plugin-sdk";
 *
 * export const prototypeReadyPack = defineRulePack({
 *   id: "com.example.prototype-ready",
 *   name: "Prototype Ready",
 *   version: "1.0.0",
 *   description: "Enables all checks required for a first-build prototype.",
 *   tags: ["prototype"],
 *   rules: {
 *     "bom.missing-mpn": true,
 *     "bom.lifecycle": { enabled: true, severity: "medium" },
 *     "manufacturing.package-completeness": false,
 *   },
 * });
 * ```
 */
export function defineRulePack(pack: RulePackManifest): RulePackManifest {
  return pack;
}
