/**
 * Component intelligence: the socket a supplier data source plugs into.
 *
 * `src/bom/lifecycle.ts` already models `"supplier-plugin"` as a lifecycle source and carries
 * a `fetchedAt` provenance timestamp. This module is the cloud-side counterpart: it defines
 * what a provider must answer, and nothing about which vendor answers it.
 *
 * No provider ships with this module on purpose. Choosing one commits the project to a cost
 * model and, more importantly, to terms governing whether results may be cached across
 * customers — the open decision recorded in ADR-0012. Until that is settled the null provider
 * is the configured default, and the watch reports `no_provider` rather than inventing data.
 */

/** Canonical lifecycle states, matching the CLI's `LifecycleStatus` vocabulary. */
export type ComponentLifecycleStatus = "active" | "nrnd" | "eol" | "obsolete" | "unknown";

/** The states that represent real sourcing risk, ordered least to most severe. */
export const riskyLifecycleStatuses = ["nrnd", "eol", "obsolete"] as const;
export type RiskyLifecycleStatus = (typeof riskyLifecycleStatuses)[number];

export type ComponentQuery = {
  mpn: string;
  manufacturer?: string | undefined;
};

export type ComponentObservation = {
  mpn: string;
  manufacturer?: string | undefined;
  status: ComponentLifecycleStatus;
  /** Which provider answered, recorded so a stale claim can be traced to its source. */
  source: string;
  evidenceUrl?: string | undefined;
  observedAt: Date;
  /** When this observation should be refreshed. Absent means it never expires on its own. */
  expiresAt?: Date | undefined;
};

export type ComponentIntelligenceProvider = {
  /** Short stable identifier recorded on every observation this provider produces. */
  readonly name: string;
  /**
   * Resolves lifecycle status for the supplied parts.
   *
   * A provider may return fewer results than requested; a part it cannot identify is simply
   * absent rather than reported as `unknown`, so "we did not find it" stays distinguishable
   * from "the provider says its state is unknown".
   */
  lookup(parts: readonly ComponentQuery[]): Promise<readonly ComponentObservation[]>;
};

/**
 * The default provider: answers nothing.
 *
 * Keeps the watch pipeline runnable and testable before a vendor decision, and keeps a
 * misconfigured deployment silent rather than wrong.
 */
export function createNullComponentIntelligenceProvider(): ComponentIntelligenceProvider {
  return {
    name: "none",
    async lookup() {
      return [];
    },
  };
}

export function isRiskyLifecycleStatus(status: ComponentLifecycleStatus): status is RiskyLifecycleStatus {
  return (riskyLifecycleStatuses as readonly string[]).includes(status);
}

/**
 * Maps a lifecycle status to the severity a supply finding is raised at.
 *
 * Obsolete is critical because the part cannot be ordered at all; EOL is high because
 * production will stop within a known horizon; NRND is medium because existing builds
 * continue while new designs should move away.
 */
export function supplyFindingSeverity(status: RiskyLifecycleStatus): "critical" | "high" | "medium" {
  if (status === "obsolete") return "critical";
  if (status === "eol") return "high";
  return "medium";
}

/**
 * Normalized key for matching a part across BOM rows, observations, and findings.
 *
 * Encoded as a JSON pair rather than joined with a separator: a manufacturer name can
 * contain almost any character, and this leaves no way for two different parts to
 * collapse onto the same key.
 */
export function componentKey(part: ComponentQuery): string {
  return JSON.stringify([part.mpn.trim().toLowerCase(), (part.manufacturer ?? "").trim().toLowerCase()]);
}

/**
 * Reduces a board's components to the distinct parts worth asking a provider about.
 *
 * Components without a manufacturer part number are dropped: there is nothing to match on,
 * and the dashboard already reports how many a board has so the gap stays visible rather
 * than silently shrinking the query.
 */
export function queryablePartsOf(
  components: readonly { mpn?: string | undefined; manufacturer?: string | undefined }[],
): ComponentQuery[] {
  const byKey = new Map<string, ComponentQuery>();
  for (const component of components) {
    const mpn = component.mpn?.trim();
    if (!mpn) continue;
    const part: ComponentQuery = {
      mpn,
      ...(component.manufacturer?.trim() ? { manufacturer: component.manufacturer.trim() } : {}),
    };
    byKey.set(componentKey(part), part);
  }
  return [...byKey.values()];
}
