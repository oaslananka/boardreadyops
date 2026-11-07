import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserSchemaCoverage } from "../../../packages/db/src/data-export-historical-schema-coverage.js";

const column = (
  table_name: string,
  column_name = "tenant_id",
  data_type = "text",
  is_nullable: "YES" | "NO" = "NO",
) => ({ table_name, column_name, data_type, is_nullable });

function adapter(rows: unknown) {
  const query = vi.fn(async (_sql: string) => ({ rows }));
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  return { query, withTransaction, db: { withTransaction } as never };
}

describe("original numeric USER source schema coverage must never grant customer export", () => {
  it("rejects missing database access without a catalog read", async () => {
    expect(await assessHistoricalUserSchemaCoverage(null as never)).toMatchObject({
      status: "unavailable",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      releaseDecision: "NO_GO",
    });
  });

  it("reports a newly added source table as schema drift, not customer completeness", async () => {
    const fake = adapter([column("repositories"), column("unclassified_tenant_credentials")]);
    const result = await assessHistoricalUserSchemaCoverage(fake.db);
    expect(result).toMatchObject({
      status: "schema_drift",
      tableCount: 2,
      columnCount: 2,
      unrecognizedTableCount: 1,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      releaseDecision: "NO_GO",
    });
    expect(fake.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    const sql = fake.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("table_type='BASE TABLE'");
    expect(sql).toContain("ORDER BY c.table_name,c.ordinal_position");
    expect(sql).toContain("LIMIT 1201");
    expect(sql).not.toContain("SELECT *");
  });

  it("treats known source classes as only private partial metadata or withheld, not delivery rights", async () => {
    const fake = adapter([column("repositories"), column("findings"), column("api_tokens"), column("data_exports")]);
    const result = await assessHistoricalUserSchemaCoverage(fake.db);
    expect(result).toMatchObject({
      status: "schema_drift",
      tableCount: 4,
      partialPrivateMetadataTableCount: 2,
      withheldSensitiveTableCount: 1,
      otherTablesRequiringScopeReview: 1,
      unrecognizedTableCount: 0,
      customerDeliveryAllowed: false,
    });
  });

  it.each([
    ["missing rows", null],
    ["empty catalog", []],
    ["fake object", { length: 1 }],
    ["ambiguous NULL", [null]],
    ["unknown type", [column("repositories", "tenant_id", "")]],
    ["untrusted identifier", [column("select * from secrets")]],
    ["duplicate column identity", [column("repositories"), column("repositories")]],
    ["unbounded catalog", Array.from({ length: 1201 }, (_, i) => column("table", `col_${i}`))],
  ])("fails closed on %s", async (_, rows) => {
    const fake = adapter(rows);
    const result = await assessHistoricalUserSchemaCoverage(fake.db);
    expect(result).toMatchObject({
      status: "unavailable",
      releaseDecision: "NO_GO",
      customerDeliveryAllowed: false,
      completeCustomerExport: false,
    });
  });

  it("returns only NO_GO when catalog query throws or the transaction is unavailable", async () => {
    const fake = adapter([]);
    fake.query.mockRejectedValueOnce(new Error("catalog permission denied"));
    expect(await assessHistoricalUserSchemaCoverage(fake.db)).toMatchObject({
      status: "unavailable",
      customerDeliveryAllowed: false,
    });
    const fail = { withTransaction: vi.fn().mockRejectedValue(new Error("database temporarily offline")) };
    expect(await assessHistoricalUserSchemaCoverage(fail as never)).toMatchObject({
      status: "unavailable",
      releaseDecision: "NO_GO",
    });
  });
});
