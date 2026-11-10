import {
  historicalUserKnownPublicTables,
  historicalUserUnresolvedSourceReviewTracks,
} from "./data-export-historical-schema-coverage.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * INTERNAL source-review aid: PostgreSQL FK metadata only, never customer rows.
 * A structural FK chain is NOT a proof of original USER identity, consent,
 * customer ownership, lawful disclosure, legal hold or complete customer ZIP.
 */
type Link = {
  source_table: string;
  target_table: string;
  constraint_name: string;
  required: boolean;
  validated: true;
};
type ReviewTrack = keyof typeof historicalUserUnresolvedSourceReviewTracks;
type Entry = {
  table: string;
  reviewTrack: ReviewTrack;
  installationPath: string[] | null;
  reportedPathUsesNonNullableFKs: boolean;
};
export type HistoricalUserUnresolvedLineageReview = {
  status: "structural-lineage-only-unapproved";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  reviewedClasses: 63;
  fkCatalogEdges: number;
  pathToInstallationCount: number;
  noPathCount: number;
  entries: Entry[];
};

const identifier = /^[a-z][a-z0-9_]{0,127}$/u;
const maxForeignKeys = 400;
const reviewTracks = historicalUserUnresolvedSourceReviewTracks;
const names = Object.values(reviewTracks).flat();
const allKnownTables = new Set<string>(historicalUserKnownPublicTables);

function validLink(value: unknown): value is Link {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.source_table === "string" &&
    allKnownTables.has(row.source_table) &&
    typeof row.target_table === "string" &&
    allKnownTables.has(row.target_table) &&
    typeof row.constraint_name === "string" &&
    identifier.test(row.constraint_name) &&
    typeof row.required === "boolean" &&
    // A NOT VALID FK can exist without proving existing historical rows
    // satisfy the relationship; an unknown validation state is no proof.
    row.validated === true
  );
}

/** Prefer a path whose EVERY FK column is non-nullable when one exists.
 * Choosing the first catalog-ordered route can otherwise report an
 * optional FK path even if a stronger fully-required route is available.
 * Still only structural metadata, NEVER proof of actual user ownership.
 */
function pathToInstallation(
  start: string,
  links: ReadonlyMap<string, Link[]>,
): { path: string[] | null; required: boolean } {
  const findPath = (requireNonNullable: boolean): string[] | null => {
    const pending = [[start]];
    const visited = new Set([start]);
    for (const path of pending) {
      const current = path[path.length - 1];
      if (current === undefined) return null;
      if (current === "installations") return path;
      for (const link of links.get(current) ?? []) {
        if (requireNonNullable && !link.required) continue;
        if (visited.has(link.target_table)) continue;
        visited.add(link.target_table);
        pending.push([...path, link.target_table]);
      }
    }
    return null;
  };
  const requiredPath = findPath(true);
  if (requiredPath) return { path: requiredPath, required: true };
  return { path: findPath(false), required: false };
}

const publicTableCatalogSql = [
  "SELECT relation.relname AS table_name FROM pg_catalog.pg_class relation",
  "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace",
  "WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')",
  "ORDER BY relation.relname LIMIT 93",
].join(" ");

const catalogSql = [
  "SELECT source.relname AS source_table, target.relname AS target_table,",
  "c.conname AS constraint_name, c.convalidated AS validated,",
  "NOT EXISTS (SELECT 1 FROM unnest(c.conkey) AS key(attnum)",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum",
  "WHERE a.attnotnull=FALSE) AS required",
  "FROM pg_catalog.pg_constraint c",
  "JOIN pg_catalog.pg_class source ON source.oid=c.conrelid",
  "JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid=source.relnamespace",
  "JOIN pg_catalog.pg_class target ON target.oid=c.confrelid",
  "JOIN pg_catalog.pg_namespace dst_ns ON dst_ns.oid=target.relnamespace",
  "WHERE c.contype='f' AND src_ns.nspname='public' AND dst_ns.nspname='public'",
  "ORDER BY source.relname,target.relname,c.conname LIMIT 401",
].join(" ");

/** Only catalog metadata; never read a real customer table or infer rights. */
export async function assessHistoricalUserUnresolvedSourceLineage(
  db: Pick<PgQueryExecutor, "withTransaction">,
): Promise<HistoricalUserUnresolvedLineageReview | null> {
  if (!db?.withTransaction || names.length !== 63 || new Set(names).size !== 63 || allKnownTables.size !== 92)
    return null;
  try {
    return await db.withTransaction(
      async (tx) => {
        // Report ONLY exact, presently existing schema classes. An absent,
        // renamed or newly added table invalidates this review, even when
        // the 123 FK edges still appear otherwise plausible.
        const tables: unknown = await tx.query(publicTableCatalogSql);
        if (!tables || typeof tables !== "object" || !("rows" in tables) || !Array.isArray(tables.rows)) return null;
        const present: unknown[] = tables.rows;
        if (
          present.length !== allKnownTables.size ||
          !present.every(
            (row) =>
              row !== null &&
              typeof row === "object" &&
              !Array.isArray(row) &&
              "table_name" in row &&
              typeof row.table_name === "string" &&
              allKnownTables.has(row.table_name),
          ) ||
          new Set(present.map((row) => (row as { table_name: string }).table_name)).size !== allKnownTables.size
        )
          return null;
        const response: unknown = await tx.query(catalogSql);
        if (!response || typeof response !== "object" || !("rows" in response) || !Array.isArray(response.rows))
          return null;
        const raw: unknown[] = response.rows;
        if (raw.length === 0 || raw.length > maxForeignKeys || !raw.every(validLink)) return null;
        const edges = raw as Link[];
        const unique = new Set(edges.map((link) => [link.source_table, link.constraint_name].join(":")));
        if (unique.size !== edges.length) return null;
        if (
          !edges.some((edge) => edge.source_table === "repositories" && edge.target_table === "installations") ||
          !edges.some((edge) => edge.source_table === "release_runs" && edge.target_table === "repositories")
        )
          return null;
        const links = new Map<string, Link[]>();
        for (const edge of edges) {
          const list = links.get(edge.source_table) ?? [];
          list.push(edge);
          links.set(edge.source_table, list);
        }
        const entries: Entry[] = [];
        for (const reviewTrack of Object.keys(reviewTracks) as ReviewTrack[]) {
          for (const table of reviewTracks[reviewTrack]) {
            const scope = pathToInstallation(table, links);
            entries.push({
              table,
              reviewTrack,
              installationPath: scope.path,
              reportedPathUsesNonNullableFKs: scope.required,
            });
          }
        }
        const pathToInstallationCount = entries.filter((entry) => entry.installationPath !== null).length;
        return {
          status: "structural-lineage-only-unapproved",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          reviewedClasses: 63,
          fkCatalogEdges: edges.length,
          pathToInstallationCount,
          noPathCount: 63 - pathToInstallationCount,
          entries,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
