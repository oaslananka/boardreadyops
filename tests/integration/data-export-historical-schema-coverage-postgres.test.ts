import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessHistoricalUserSchemaCoverage } from "../../packages/db/src/data-export-historical-schema-coverage.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;

describeDb("disposable PG17: historical original USER full-source schema drift guard", () => {
  it("pins all 92 public tables and 1,033 columns from migrations 0001-0126, but never asserts delivery-ready", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL is required");
    const db = createPgQueryExecutor({ connectionString });
    try {
      expect(await assessHistoricalUserSchemaCoverage(db)).toEqual({
        status: "known_schema_scope_unapproved",
        releaseDecision: "NO_GO",
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
        tableCount: 92,
        columnCount: 1033,
        partialPrivateMetadataTableCount: 13,
        withheldSensitiveTableCount: 16,
        otherTablesRequiringScopeReview: 63,
        unrecognizedTableCount: 0,
        schemaSha256: "45d6db6d25b6e61a0950333a5f9d81b17e2895c21736688b08cc00d49b3dfe63",
      });
    } finally {
      await db.close();
    }
  });

  it("detects a REAL new PUBLIC persistence table inside a rolled-back PostgreSQL transaction", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL is required");
    const db = createPgQueryExecutor({ connectionString });
    const name = `boardreadyops_scope_probe_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("Scope probe rollback sentinel");
    try {
      await expect(
        db.withTransaction(async (tx) => {
          await tx.query(`CREATE TABLE public.${name}(id integer PRIMARY KEY,tenant_id text)`);
          const readWithinSameSnapshot = {
            async withTransaction<T>(
              work: (transaction: typeof tx) => Promise<T>,
              options?: { consistentRead?: true; statementTimeoutMs?: number },
            ): Promise<T> {
              if (options?.consistentRead !== true) throw new Error("Must remain consistent");
              return work(tx);
            },
          };
          const changed = await assessHistoricalUserSchemaCoverage(readWithinSameSnapshot as never);
          expect(changed).toMatchObject({
            status: "schema_drift",
            releaseDecision: "NO_GO",
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            tableCount: 93,
            columnCount: 1035,
            unrecognizedTableCount: 1,
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      const absent = await db.query("SELECT to_regclass($1) AS table_name", [`public.${name}`]);
      expect((absent as { rows?: Array<{ table_name: string | null }> }).rows?.[0]?.table_name).toBeNull();
    } finally {
      await db.close();
    }
  });
});
