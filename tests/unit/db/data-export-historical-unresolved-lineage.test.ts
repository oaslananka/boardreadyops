import { describe, expect, it, vi } from "vitest";
import { historicalUserKnownPublicTables } from "../../../packages/db/src/data-export-historical-schema-coverage.js";
import { assessHistoricalUserUnresolvedSourceLineage } from "../../../packages/db/src/data-export-historical-unresolved-lineage.js";

type Edge = {
  source_table: string;
  target_table: string;
  constraint_name: string;
  required: boolean;
  validated: boolean;
};

function catalog(...edges: Edge[]) {
  const sql = vi.fn(async (query: string) =>
    query.includes("pg_catalog.pg_class relation")
      ? { rows: historicalUserKnownPublicTables.map((table_name) => ({ table_name })) }
      : query.includes("pg_catalog.pg_constraint c")
        ? { rows: edges }
        : { rows: [] },
  );
  const db = {
    withTransaction: vi.fn(async (work: (tx: { query: typeof sql }) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ consistentRead: true, statementTimeoutMs: 5000 });
      return work({ query: sql });
    }),
  };
  return { db, sql };
}

const edge = (source: string, target: string, required = true, validated = true): Edge => ({
  source_table: source,
  target_table: target,
  constraint_name: `fk_${source}_${target}`,
  required,
  validated,
});

describe("original-user historical 63-class FK lineage remains source-only and fail closed", () => {
  it("prefers an all-non-nullable validated path when an earlier optional path also exists", async () => {
    const { db, sql } = catalog(
      edge("boards", "installations", false),
      edge("boards", "repositories"),
      edge("release_runs", "repositories"),
      edge("repositories", "installations"),
    );
    const report = await assessHistoricalUserUnresolvedSourceLineage(db as never);
    expect(report?.entries.find((entry) => entry.table === "boards")).toMatchObject({
      installationPath: ["boards", "repositories", "installations"],
      reportedPathUsesNonNullableFKs: true,
    });
    expect(sql.mock.calls.some(([query]) => query.includes("c.convalidated AS validated"))).toBe(true);
    expect(report).toMatchObject({
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
    });
  });

  it("preserves an explicitly optional path when no all-required path exists, including graph cycles", async () => {
    const { db } = catalog(
      edge("boards", "repositories", false),
      edge("repositories", "boards"),
      edge("repositories", "installations"),
      edge("release_runs", "repositories"),
    );
    const report = await assessHistoricalUserUnresolvedSourceLineage(db as never);
    expect(report?.entries.find((entry) => entry.table === "boards")).toMatchObject({
      installationPath: ["boards", "repositories", "installations"],
      reportedPathUsesNonNullableFKs: false,
    });
    expect(report?.customerDeliveryAllowed).toBe(false);
  });

  it("does not trust an unvalidated PostgreSQL FK as established historical USER lineage", async () => {
    const { db } = catalog(edge("repositories", "installations"), edge("release_runs", "repositories", true, false));
    expect(await assessHistoricalUserUnresolvedSourceLineage(db as never)).toBeNull();
  });

  it("does not trust missing validation evidence for an FK", async () => {
    const { db } = catalog(edge("repositories", "installations"), {
      ...edge("release_runs", "repositories"),
      validated: undefined,
    } as unknown as Edge);
    expect(await assessHistoricalUserUnresolvedSourceLineage(db as never)).toBeNull();
  });
});
