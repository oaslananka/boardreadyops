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
        mutationEpochTriggerCount: 13,
        mutationEpochFunctionCount: 6,
        mutationEpochSha256: "559ec18ed5083fc41bb4aebdf94e840fd59baf44705227b9975fa6a6d570a9a5",
        partialPrivateMetadataTableCount: 13,
        withheldSensitiveTableCount: 16,
        otherTablesRequiringScopeReview: 63,
        unresolvedReviewTrackCounts: {
          privacy_lifecycle: 17,
          billing_and_marketplace: 5,
          hardware_and_release: 19,
          collaboration_and_workspace: 10,
          platform_operations: 12,
        },
        unrecognizedTableCount: 0,
        schemaSha256: "45d6db6d25b6e61a0950333a5f9d81b17e2895c21736688b08cc00d49b3dfe63",
      });
    } finally {
      await db.close();
    }
  });

  it("detects a disabled original-user ABA trigger inside a rolled-back transaction", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL is required");
    const db = createPgQueryExecutor({ connectionString });
    const rollback = new Error("Disabled mutation trigger probe rollback");
    try {
      await expect(
        db.withTransaction(async (tx) => {
          await tx.query("ALTER TABLE public.run_snapshots DISABLE TRIGGER boardreadyops_historical_visual_epoch");
          const changed = await assessHistoricalUserSchemaCoverage({
            async withTransaction<T>(
              work: (connection: typeof tx) => Promise<T>,
              options?: { consistentRead?: true; statementTimeoutMs?: number },
            ): Promise<T> {
              if (options?.consistentRead !== true || options.statementTimeoutMs !== 5000)
                throw new Error("Must remain consistent");
              return work(tx);
            },
          } as never);
          expect(changed).toMatchObject({
            status: "schema_drift",
            mutationEpochTriggerCount: 13,
            mutationEpochFunctionCount: 6,
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            releaseDecision: "NO_GO",
          });
          expect(changed.mutationEpochSha256).not.toBe(
            "559ec18ed5083fc41bb4aebdf94e840fd59baf44705227b9975fa6a6d570a9a5",
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.close();
    }
  });

  it("detects a modified mutation-epoch function body inside a rolled-back transaction", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL is required");
    const db = createPgQueryExecutor({ connectionString });
    const rollback = new Error("Mutation function probe rollback");
    try {
      await expect(
        db.withTransaction(async (tx) => {
          await tx.query(
            "CREATE OR REPLACE FUNCTION public.boardreadyops_note_historical_audit_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$ BEGIN RETURN NULL; END; $$",
          );
          const changed = await assessHistoricalUserSchemaCoverage({
            async withTransaction<T>(
              work: (connection: typeof tx) => Promise<T>,
              options?: { consistentRead?: true; statementTimeoutMs?: number },
            ): Promise<T> {
              if (options?.consistentRead !== true || options.statementTimeoutMs !== 5000)
                throw new Error("Must remain consistent");
              return work(tx);
            },
          } as never);
          expect(changed).toMatchObject({
            status: "schema_drift",
            mutationEpochTriggerCount: 13,
            mutationEpochFunctionCount: 6,
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            releaseDecision: "NO_GO",
          });
          expect(changed.mutationEpochSha256).not.toBe(
            "559ec18ed5083fc41bb4aebdf94e840fd59baf44705227b9975fa6a6d570a9a5",
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
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
