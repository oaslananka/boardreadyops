import { describe, expect, it, vi } from "vitest";
import { historicalUserKnownPublicTables } from "../../../packages/db/src/data-export-historical-schema-coverage.js";
import { assessHistoricalUserUnresolvedSourceLineage } from "../../../packages/db/src/data-export-historical-unresolved-lineage.js";

const edge = (
  source_table: string,
  target_table: string,
  required = true,
  constraint_name = ["fk_", source_table].join(""),
) => ({
  source_table,
  target_table,
  required,
  constraint_name,
  validated: true,
});
function fixture(rows: unknown) {
  const query = vi.fn(
    async (sql: string): Promise<unknown> =>
      sql.includes("relation.relkind")
        ? { rows: historicalUserKnownPublicTables.map((table_name) => ({ table_name })) }
        : { rows },
  );
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { query, withTransaction, db: { withTransaction } as never };
}
const roots = [edge("repositories", "installations"), edge("release_runs", "repositories")];

describe("original USER unresolved-class FK lineage is structural ONLY, NEVER an export right", () => {
  it("accounts for all 63 unresolved classes and never reads a customer row", async () => {
    const f = fixture([
      ...roots,
      edge("boards", "repositories"),
      edge("data_exports", "installations", false),
      edge("board_bom_snapshots", "boards"),
    ]);
    const report = await assessHistoricalUserUnresolvedSourceLineage(f.db);
    expect(report).toMatchObject({
      status: "structural-lineage-only-unapproved",
      reviewedClasses: 63,
      fkCatalogEdges: 5,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      releaseDecision: "NO_GO",
    });
    expect(report?.entries).toHaveLength(63);
    expect(new Set(report?.entries.map((entry) => entry.table)).size).toBe(63);
    expect(report?.entries.find((entry) => entry.table === "board_bom_snapshots")).toMatchObject({
      installationPath: ["board_bom_snapshots", "boards", "repositories", "installations"],
      reportedPathUsesNonNullableFKs: true,
    });
    expect(report?.entries.find((entry) => entry.table === "data_exports")).toMatchObject({
      installationPath: ["data_exports", "installations"],
      reportedPathUsesNonNullableFKs: false,
    });
    expect(report?.entries.find((entry) => entry.table === "billing_events")?.installationPath).toBeNull();
    expect(report?.pathToInstallationCount).toBe(4);
    expect(report?.noPathCount).toBe(59);
    expect(f.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(f.query).toHaveBeenCalledTimes(2);
    const tableSql = f.query.mock.calls[0]?.[0] ?? "";
    expect(tableSql).toContain("pg_catalog.pg_class");
    expect(tableSql).toContain("LIMIT 93");
    const sql = f.query.mock.calls[1]?.[0] ?? "";
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("c.convalidated AS validated");
    expect(sql).toContain("pg_catalog.pg_attribute");
    expect(sql).not.toMatch(/FROM\s+public\./iu);
    expect(sql).not.toContain("SELECT *");
    expect(sql).toContain("LIMIT 401");
  });

  it("rejects schema drift when a required table is renamed, missing or newly added", async () => {
    const f = fixture(roots);
    f.query.mockResolvedValueOnce({
      rows: historicalUserKnownPublicTables
        .filter((table) => table !== "data_exports")
        .map((table_name) => ({
          table_name,
        })),
    });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();

    f.query.mockClear();
    f.query.mockResolvedValueOnce({
      rows: [...historicalUserKnownPublicTables, "unreviewed_private_table"].map((table_name) => ({ table_name })),
    });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it("denies malformed PostgreSQL table catalogs before checking foreign keys", async () => {
    const f = fixture(roots);
    f.query.mockResolvedValueOnce({ notRows: [] });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();

    f.query.mockClear();
    f.query.mockResolvedValueOnce({
      rows: historicalUserKnownPublicTables.map((table_name) =>
        table_name === "boards" ? { table_name: 1234 } : { table_name },
      ),
    });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();

    f.query.mockClear();
    f.query.mockResolvedValueOnce({
      rows: historicalUserKnownPublicTables.map((table_name) =>
        table_name === "boards" ? { table_name: "installations" } : { table_name },
      ),
    });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it("denies absent, empty or malformed FK catalog responses without disclosing ownership", async () => {
    const f = fixture(roots);
    for (const malformed of [
      { notRows: [] },
      { rows: [] },
      { rows: [...roots, { ...edge("boards", "repositories"), required: "true" }] },
    ]) {
      f.query.mockResolvedValueOnce({
        rows: historicalUserKnownPublicTables.map((table_name) => ({ table_name })),
      });
      f.query.mockResolvedValueOnce(malformed);
      expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    }
  });

  it("rejects foreign-key references to unknown tables and malformed identifier names", async () => {
    const f = fixture(roots);
    for (const bad of [
      edge("boards", "unlisted_private_table"),
      { ...edge("boards", "repositories"), constraint_name: "unexpected whitespace" },
      { ...edge("boards", "repositories"), source_table: null },
    ]) {
      f.query.mockResolvedValueOnce({
        rows: historicalUserKnownPublicTables.map((table_name) => ({ table_name })),
      });
      f.query.mockResolvedValueOnce({ rows: [...roots, bad] });
      expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    }
  });

  it("denies a missing original installation/repository root even when tables are named correctly", async () => {
    const f = fixture([edge("boards", "repositories"), edge("release_runs", "repositories")]);
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
  });

  it("rejects private raw data and unrecognized catalog edges", async () => {
    const f = fixture([...roots, { ...edge("boards", "repositories"), secret: "never returned" }]);
    expect((await assessHistoricalUserUnresolvedSourceLineage(f.db))?.entries).toHaveLength(63);
    f.query.mockResolvedValueOnce({ rows: [...roots, edge("unknown_secret_table", "repositories")] });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
  });

  it("rejects duplicate/ambiguous and oversized PostgreSQL FK catalog results", async () => {
    const f = fixture([...roots, roots[0]]);
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
    const large = Array.from({ length: 401 }, (_, n) =>
      edge("boards", "repositories", true, ["fk_", String(n)].join("")),
    );
    f.query.mockResolvedValueOnce({ rows: large });
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
  });

  it("does not infer original USER identity from cycles or nonexistent foreign-key paths", async () => {
    const f = fixture([
      ...roots,
      edge("board_supply_watch", "board_supply_findings"),
      edge("board_supply_findings", "board_supply_watch"),
    ]);
    const report = await assessHistoricalUserUnresolvedSourceLineage(f.db);
    expect(report?.entries.find((entry) => entry.table === "board_supply_watch")?.installationPath).toBeNull();
    expect(report?.originalUserOwnershipVerified).toBe(false);
  });

  it("fails closed on a missing adapter or database exception", async () => {
    expect(await assessHistoricalUserUnresolvedSourceLineage(null as never)).toBeNull();
    const f = fixture(roots);
    f.query.mockRejectedValueOnce(new Error("PG unavailable"));
    expect(await assessHistoricalUserUnresolvedSourceLineage(f.db)).toBeNull();
  });
});
