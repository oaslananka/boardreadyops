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

/** Top-level plugin export consumed by BoardReadyOps plugin loading. */
export interface BoardReadyOpsPlugin {
  name: string;
  version: string;
  permissions?: PluginPermission[] | undefined;
  rules?: Rule[] | undefined;
  adapters?: ComponentAdapter[] | undefined;
  reportFormats?: ReportEmitter[] | undefined;
  vendorProfiles?: VendorProfile[] | undefined;
  notifiers?: Notifier[] | undefined;
  /** Supplier intelligence providers contributed by this plugin. */
  supplierProviders?: SupplierIntelligenceProvider[] | undefined;
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
