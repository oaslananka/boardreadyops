import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import { historicalUserKnownPublicTables } from "./data-export-historical-schema-coverage.js";
import { assessHistoricalUserUnresolvedSourceLineage } from "./data-export-historical-unresolved-lineage.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * SOURCE ONLY / NO CUSTOMER DELIVERY. An FK path and even a matching row
 * do not prove original USER ownership, lawful disclosure or completeness.
 * Count only bounded original-numeric-USER-linked source rows; leave every
 * non-FK class unlinked and every source class unauthorized for disclosure.
 */
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const identifier = /^[a-z][a-z0-9_]{0,127}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const known = new Set<string>(historicalUserKnownPublicTables);
const limit = 101;

type Fk = {
  source_table: string;
  target_table: string;
  constraint_name: string;
  validated: true;
  required: boolean;
  source_columns: string[];
  target_columns: string[];
};

type LinkedRowCount = {
  table: string;
  installationPath: string[];
  boundedLinkedRows: number;
  /** Private DB-only row multiset digest; never a customer permission. */
  rowMultisetSha256: string;
  requiredFkPath: boolean;
};

export type HistoricalUserUnresolvedOwnerRowReview = {
  status: "bounded-source-row-fk-candidates-unapproved";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  reviewedClasses: 63;
  linkedRowCounts: LinkedRowCount[];
  ambiguousFkPathClasses: string[];
  noInstallationPath: string[];
};

const mappedFkSql = [
  "SELECT source.relname AS source_table,target.relname AS target_table,",
  "c.conname AS constraint_name,c.convalidated AS validated,",
  "NOT EXISTS (SELECT 1 FROM unnest(c.conkey) AS k(attnum)",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum",
  "WHERE a.attnotnull=FALSE) AS required,",
  "ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n)",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.n)::text[] AS source_columns,",
  "ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(attnum,n)",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.n)::text[] AS target_columns",
  "FROM pg_catalog.pg_constraint c",
  "JOIN pg_catalog.pg_class source ON source.oid=c.conrelid",
  "JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid=source.relnamespace",
  "JOIN pg_catalog.pg_class target ON target.oid=c.confrelid",
  "JOIN pg_catalog.pg_namespace dst_ns ON dst_ns.oid=target.relnamespace",
  "WHERE c.contype='f' AND src_ns.nspname='public' AND dst_ns.nspname='public'",
  "ORDER BY source.relname,target.relname,c.conname LIMIT 401",
].join(" ");

function validMappedFk(raw: unknown): raw is Fk {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    typeof value.source_table === "string" &&
    known.has(value.source_table) &&
    typeof value.target_table === "string" &&
    known.has(value.target_table) &&
    typeof value.constraint_name === "string" &&
    identifier.test(value.constraint_name) &&
    value.validated === true &&
    typeof value.required === "boolean" &&
    Array.isArray(value.source_columns) &&
    Array.isArray(value.target_columns) &&
    value.source_columns.length >= 1 &&
    value.source_columns.length <= 8 &&
    value.source_columns.length === value.target_columns.length &&
    value.source_columns.every((v: unknown) => typeof v === "string" && identifier.test(v)) &&
    value.target_columns.every((v: unknown) => typeof v === "string" && identifier.test(v))
  );
}

/** Catalog-derived column names are strictly validated before SQL assembly.
 * Ambiguous parallel FKs deny this diagnostic instead of choosing silently.
 */
function boundedRowSql(table: string, path: string[], required: boolean, fks: Fk[]): string | "ambiguous" | null {
  if (!identifier.test(table) || path[0] !== table || path.at(-1) !== "installations") return null;
  let from = "public." + table + " AS r0";
  for (let i = 0; i < path.length - 1; i++) {
    const source = path[i];
    const target = path[i + 1];
    if (!source || !target) return null;
    const candidates = fks.filter(
      (fk) => fk.source_table === source && fk.target_table === target && (!required || fk.required),
    );
    if (candidates.length === 0) return null;
    // Never guess which of two independent FKs carries source ownership.
    if (candidates.length > 1) return "ambiguous";
    const fk = candidates[0];
    if (!fk) return null;
    const joins = fk.source_columns.map((col, index) => {
      const opposite = fk.target_columns[index];
      return "r" + i + "." + col + "=r" + (i + 1) + "." + opposite;
    });
    from += " JOIN public." + target + " AS r" + (i + 1) + " ON " + joins.join(" AND ");
  }
  from +=
    " JOIN former_installations AS original_user_installation ON original_user_installation.id=r" +
    (path.length - 1) +
    ".id";
  // PostgreSQL hashes each source row, sorts hashes as a multiset and
  // returns ONLY bounded count+digest metadata. Count-preserving edits
  // change the digest. ABA restoration needs independent mutation epochs.
  return `(SELECT jsonb_build_object(
    'count',count(*)::integer,
    'sha256',encode(digest(COALESCE(string_agg(row_hash, ':' ORDER BY row_hash), ''), 'sha256'),'hex')
  ) FROM (
    SELECT encode(digest(to_jsonb(r0)::text,'sha256'),'hex') AS row_hash
    FROM ${from} LIMIT ${limit}
  ) AS bounded_rows)`;
}

export async function assessHistoricalUserUnresolvedOwnerRows(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserUnresolvedOwnerRowReview | null> {
  if (
    !db?.withTransaction ||
    !uuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0 ||
    known.size !== 92
  )
    return null;
  // The target of SQL and its returned acknowledgement cannot drift between
  // asynchronous catalog discovery and read-only original USER row counts.
  const original = Object.freeze({ exportId: input.exportId, verifiedGitHubUserId: input.verifiedGitHubUserId });
  try {
    return await db.withTransaction(
      async (tx) => {
        // Reuse the established 92-table, 63-class and FK validation inside
        // this EXACT repeatable-read snapshot, not a second PG transaction.
        const shared = {
          async withTransaction<T>(
            work: (transaction: typeof tx) => Promise<T>,
            options?: { consistentRead?: true; statementTimeoutMs?: number },
          ): Promise<T> {
            if (options?.consistentRead !== true || options.statementTimeoutMs !== 5000)
              throw new Error("Historical FK scope was not bound to the same snapshot");
            return work(tx);
          },
        };
        const lineage = await assessHistoricalUserUnresolvedSourceLineage(shared);
        if (
          lineage?.reviewedClasses !== 63 ||
          lineage.releaseDecision !== "NO_GO" ||
          lineage.entries.length !== 63 ||
          lineage.pathToInstallationCount + lineage.noPathCount !== 63
        )
          return null;

        const result: unknown = await tx.query(mappedFkSql);
        if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
        const mappings: unknown[] = result.rows;
        if (
          mappings.length !== lineage.fkCatalogEdges ||
          !mappings.length ||
          mappings.length > 400 ||
          !mappings.every(validMappedFk)
        )
          return null;
        const fks = mappings as Fk[];
        if (new Set(fks.map((fk) => fk.source_table + ":" + fk.constraint_name)).size !== fks.length) return null;

        const linked = lineage.entries.filter((entry) => entry.installationPath !== null);
        const unlinked = lineage.entries.filter((entry) => entry.installationPath === null);
        if (linked.length !== lineage.pathToInstallationCount || unlinked.length !== lineage.noPathCount) return null;
        const statements: string[] = [];
        const selected: typeof linked = [];
        const ambiguousFkPathClasses: string[] = [];
        for (const entry of linked) {
          const expression = boundedRowSql(
            entry.table,
            entry.installationPath ?? [],
            entry.reportedPathUsesNonNullableFKs,
            fks,
          );
          if (!expression) return null;
          if (expression === "ambiguous") {
            ambiguousFkPathClasses.push(entry.table);
            continue;
          }
          selected.push(entry);
          statements.push("'" + entry.table + "'," + expression);
        }
        // A single statement checks original numeric USER/expiry/hold/erasure
        // and counts every selected FK-linked class in the SAME snapshot.
        const sql =
          "WITH " +
          historicalOwnerCtes +
          " SELECT owner_export.id AS export_id," +
          "jsonb_build_object(" +
          statements.join(",") +
          ") AS linked_counts FROM owner_export " +
          "WHERE EXISTS (SELECT 1 FROM former_installations) LIMIT 1";
        const observed: unknown = await tx.query(sql, [original.exportId, original.verifiedGitHubUserId]);
        if (
          !observed ||
          typeof observed !== "object" ||
          !("rows" in observed) ||
          !Array.isArray(observed.rows) ||
          observed.rows.length !== 1
        )
          return null;
        const candidate: unknown = observed.rows[0];
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
        const row = candidate as Record<string, unknown>;
        const counts = row.linked_counts;
        if (row.export_id !== original.exportId || !counts || typeof counts !== "object" || Array.isArray(counts))
          return null;
        const values = counts as Record<string, unknown>;
        const validCountAndDigest = (value: unknown): value is { count: number; sha256: string } => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return false;
          const v = value as Record<string, unknown>;
          return (
            Object.keys(v).length === 2 &&
            typeof v.count === "number" &&
            Number.isSafeInteger(v.count) &&
            v.count >= 0 &&
            v.count < limit &&
            typeof v.sha256 === "string" &&
            sha256.test(v.sha256)
          );
        };
        if (
          Object.keys(values).length !== selected.length ||
          selected.some((entry) => !validCountAndDigest(values[entry.table]))
        )
          return null;
        return {
          status: "bounded-source-row-fk-candidates-unapproved",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          reviewedClasses: 63,
          linkedRowCounts: selected.map((entry) => ({
            table: entry.table,
            installationPath: entry.installationPath ?? [],
            boundedLinkedRows: (values[entry.table] as { count: number; sha256: string }).count,
            rowMultisetSha256: (values[entry.table] as { count: number; sha256: string }).sha256,
            requiredFkPath: entry.reportedPathUsesNonNullableFKs,
          })),
          ambiguousFkPathClasses,
          noInstallationPath: unlinked.map((entry) => entry.table),
        };
      },
      { consistentRead: true, statementTimeoutMs: 10000 },
    );
  } catch {
    return null;
  }
}
