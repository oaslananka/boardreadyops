/**
 * Static/local supplier intelligence provider.
 *
 * Reads component intelligence records from a JSON or YAML-formatted file
 * committed alongside the project. No network access required.
 *
 * File format (JSON example):
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "updatedAt": "2026-06-01T00:00:00.000Z",
 *   "records": [
 *     {
 *       "mpn": "TPS62840DLCT",
 *       "manufacturer": "Texas Instruments",
 *       "lifecycleStatus": "active",
 *       "supplierCount": 5,
 *       "available": true,
 *       "alternates": ["TPS62840DLCR"],
 *       "restrictedSubstances": false,
 *       "complianceNotes": ["RoHS compliant"],
 *       "leadTimeWeeks": 8,
 *       "notes": "Verified on 2026-06-01",
 *       "trust": "verified"
 *     }
 *   ]
 * }
 * ```
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  SupplierIntelligenceProvider,
  SupplierIntelligenceQuery,
  SupplierIntelligenceRecord,
  SupplierIntelligenceResult,
} from "../../packages/plugin-sdk/src/index.js";

interface StaticSupplierDatabase {
  schemaVersion: 1;
  updatedAt?: string | undefined;
  records: SupplierIntelligenceRecord[];
}

export interface StaticSupplierProviderOptions {
  /** Path to the static database file (JSON). Relative paths are resolved from the project root. */
  dataFile: string;
  /** Override the provider display name. */
  name?: string | undefined;
}

function normalizeKey(mpn: string): string {
  return mpn.trim().toUpperCase();
}

async function loadDatabase(dataFile: string, projectRoot: string | undefined): Promise<StaticSupplierDatabase> {
  const resolved = path.isAbsolute(dataFile) ? dataFile : path.join(projectRoot ?? process.cwd(), dataFile);
  const text = await fs.readFile(resolved, "utf8");
  return JSON.parse(text) as StaticSupplierDatabase;
}

export function createStaticSupplierProvider(options: StaticSupplierProviderOptions): SupplierIntelligenceProvider {
  return {
    id: "static",
    name: options.name ?? "Static Supplier Database",
    requiresNetwork: false,
    async query(input: SupplierIntelligenceQuery): Promise<SupplierIntelligenceResult> {
      const queriedAt = new Date().toISOString();
      const warnings: string[] = [];
      const records = new Map<string, SupplierIntelligenceRecord>();
      let database: StaticSupplierDatabase;
      try {
        database = await loadDatabase(options.dataFile, input.projectRoot);
      } catch (error) {
        return {
          records,
          warnings: [
            `static provider: could not load ${options.dataFile}: ${error instanceof Error ? error.message : String(error)}`,
          ],
          queriedAt,
        };
      }
      const index = new Map<string, SupplierIntelligenceRecord>();
      for (const record of database.records ?? []) {
        if (record.mpn) {
          index.set(normalizeKey(record.mpn), record);
        }
      }
      const requestedMpns = new Set<string>();
      for (const component of input.components) {
        if (component.mpn) {
          requestedMpns.add(normalizeKey(component.mpn));
        }
      }
      for (const mpnKey of requestedMpns) {
        const record = index.get(mpnKey);
        if (record) {
          records.set(mpnKey, {
            ...record,
            trust: record.trust ?? "unverified",
            fetchedAt: record.fetchedAt ?? database.updatedAt,
          });
        }
      }
      if (database.updatedAt) {
        const ageMs = Date.now() - new Date(database.updatedAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > 90) {
          warnings.push(
            `static provider: database was last updated ${Math.round(ageDays)} days ago (${database.updatedAt}) — consider refreshing`,
          );
        }
      }
      return { records, warnings, queriedAt };
    },
  };
}

/**
 * Merge supplier intelligence records into a freshness/trust summary for
 * report blocks. Returns a compact object suitable for JSON/Markdown output.
 */
export interface SupplierIntelligenceSummary {
  providerCount: number;
  recordCount: number;
  warnings: string[];
  freshness: "fresh" | "stale" | "unknown";
  components: Array<{
    mpn: string;
    lifecycleStatus?: string | undefined;
    available?: boolean | undefined;
    trust?: string | undefined;
    warnings?: string[] | undefined;
  }>;
}

export function buildSupplierIntelligenceSummary(
  results: SupplierIntelligenceResult[],
  providerCount: number,
): SupplierIntelligenceSummary {
  const allWarnings: string[] = [];
  const mergedRecords = new Map<string, SupplierIntelligenceRecord>();
  let hasFreshness = false;
  let allFresh = true;

  for (const result of results) {
    for (const warning of result.warnings ?? []) {
      allWarnings.push(warning);
    }
    for (const [mpn, record] of result.records) {
      const existing = mergedRecords.get(mpn);
      if (!existing || (record.trust === "verified" && existing.trust !== "verified")) {
        mergedRecords.set(mpn, record);
      }
    }
    if (result.queriedAt) {
      hasFreshness = true;
      const ageMs = Date.now() - new Date(result.queriedAt).getTime();
      if (ageMs > 7 * 24 * 60 * 60 * 1000) {
        allFresh = false;
      }
    }
  }

  const components = [...mergedRecords.values()].map((record) => {
    const componentWarnings: string[] = [];
    if (record.lifecycleStatus && record.lifecycleStatus !== "active") {
      componentWarnings.push(`lifecycle status: ${record.lifecycleStatus}`);
    }
    if (record.restrictedSubstances) {
      componentWarnings.push("restricted substances flag set");
    }
    return {
      mpn: record.mpn,
      lifecycleStatus: record.lifecycleStatus,
      available: record.available,
      trust: record.trust,
      warnings: componentWarnings.length > 0 ? componentWarnings : undefined,
    };
  });

  return {
    providerCount,
    recordCount: mergedRecords.size,
    warnings: allWarnings,
    freshness: !hasFreshness ? "unknown" : allFresh ? "fresh" : "stale",
    components,
  };
}
