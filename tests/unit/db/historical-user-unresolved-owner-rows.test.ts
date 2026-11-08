import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { historicalUserKnownPublicTables } from "../../../packages/db/src/data-export-historical-schema-coverage.js";
import { assessHistoricalUserUnresolvedOwnerRows } from "../../../packages/db/src/data-export-historical-unresolved-owner-rows.js";

const rowDigest = "a".repeat(64);
function normalizeMockCounts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, count]) => [
      name,
      typeof count === "number" ? { count, sha256: rowDigest } : count,
    ]),
  );
}

const edges = [
  {
    source_table: "repositories",
    target_table: "installations",
    constraint_name: "repo_owner",
    required: true,
    validated: true,
    source_columns: ["installation_id"],
    target_columns: ["id"],
  },
  {
    source_table: "release_runs",
    target_table: "repositories",
    constraint_name: "run_repo",
    required: true,
    validated: true,
    source_columns: ["repository_id"],
    target_columns: ["id"],
  },
  {
    source_table: "boards",
    target_table: "repositories",
    constraint_name: "board_repo",
    required: true,
    validated: true,
    source_columns: ["repository_id"],
    target_columns: ["id"],
  },
];

function fixture(overrides?: { edges?: unknown[]; counts?: unknown; responseId?: string; onCatalog?: () => void }) {
  const id = randomUUID();
  const identity = { exportId: id, verifiedGitHubUserId: 8124 };
  const initial = { ...identity };
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    if (sql.includes("relation.relkind")) {
      overrides?.onCatalog?.();
      return { rows: historicalUserKnownPublicTables.map((table_name) => ({ table_name })) };
    }
    if (sql.includes("AS source_columns")) return { rows: overrides?.edges ?? edges };
    if (sql.includes("pg_catalog.pg_constraint c")) return { rows: overrides?.edges ?? edges };
    expect(args).toEqual([initial.exportId, initial.verifiedGitHubUserId]);
    expect(sql).toContain("original_user_installation.id=r");
    expect(sql).not.toContain("SELECT *");
    return {
      rows: [
        {
          export_id: overrides?.responseId ?? initial.exportId,
          linked_counts: normalizeMockCounts(overrides?.counts ?? { installations: 1, boards: 3 }),
        },
      ],
    };
  });
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ consistentRead: true, statementTimeoutMs: 10000 });
    return fn({ query });
  });
  return { db: { withTransaction } as never, identity, query, withTransaction };
}

describe("63-class original-numeric-user bounded FK row candidates remain source-only", () => {
  it("counts only existing original suspended USER FK-linked rows in one repeatable-read snapshot", async () => {
    const f = fixture();
    const observation = await assessHistoricalUserUnresolvedOwnerRows(f.db, f.identity);
    expect(observation).toMatchObject({
      status: "bounded-source-row-fk-candidates-unapproved",
      reviewedClasses: 63,
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
    });
    expect(observation?.linkedRowCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "boards",
          boundedLinkedRows: 3,
          installationPath: ["boards", "repositories", "installations"],
          requiredFkPath: true,
        }),
        expect.objectContaining({ table: "installations", boundedLinkedRows: 1 }),
      ]),
    );
    expect(observation?.linkedRowCounts.every((entry) => entry.rowMultisetSha256 === rowDigest)).toBe(true);
    expect(observation?.noInstallationPath).toContain("data_exports");
    expect((observation?.linkedRowCounts.length ?? 0) + (observation?.noInstallationPath.length ?? 0)).toBe(63);
    expect(f.query).toHaveBeenCalledTimes(4);
    expect(f.withTransaction).toHaveBeenCalledOnce();
  });

  it("pins the numeric USER before any awaited catalog request", async () => {
    let original: ReturnType<typeof fixture> | undefined;
    const f = fixture({
      onCatalog: () => {
        if (!original) return;
        original.identity.exportId = randomUUID();
        original.identity.verifiedGitHubUserId = 91;
      },
    });
    original = f;
    expect(await assessHistoricalUserUnresolvedOwnerRows(f.db, f.identity)).not.toBeNull();
  });

  it("refuses count overflows, ambiguous or foreign acknowledgement and malformed FK columns", async () => {
    for (const variant of [
      { counts: { installations: 1, boards: 101 } },
      { counts: { installations: 1 } },
      { counts: { installations: 1, boards: 2, foreign: 1 } },
      { responseId: randomUUID() },
      { counts: { installations: { count: 1, sha256: "not-a-digest" }, boards: 3 } },
      { counts: { installations: { count: 1, sha256: rowDigest, private: "leak" }, boards: 3 } },
      { edges: edges.map((e, i) => (i === 2 ? { ...e, source_columns: ["id;DROP TABLE"] } : e)) },
      { edges: edges.map((e, i) => (i === 1 ? { ...e, validated: false } : e)) },
    ]) {
      const f = fixture(variant);
      expect(await assessHistoricalUserUnresolvedOwnerRows(f.db, f.identity)).toBeNull();
    }
  });

  it("marks competing parallel FK meanings unresolved rather than claiming counted owner rows", async () => {
    const f = fixture({
      edges: [...edges, { ...edges[2], constraint_name: "board_repo_other" }],
      counts: { installations: 1 },
    });
    const report = await assessHistoricalUserUnresolvedOwnerRows(f.db, f.identity);
    expect(report?.linkedRowCounts).toHaveLength(1);
    expect(report?.ambiguousFkPathClasses).toEqual(["boards"]);
    expect(report?.customerDeliveryAllowed).toBe(false);
  });

  it("denies invalid input before reading PostgreSQL", async () => {
    const f = fixture();
    expect(
      await assessHistoricalUserUnresolvedOwnerRows(f.db, {
        exportId: "not-a-uuid",
        verifiedGitHubUserId: 1234,
      }),
    ).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });
});
