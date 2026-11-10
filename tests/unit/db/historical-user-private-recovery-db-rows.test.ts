import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserPrivateReadRecovery } from "../../../packages/db/src/data-export-historical-partial-recovery.js";

const inputBase = () => ({
  authority: { exportId: randomUUID(), verifiedGitHubUserId: 415 },
  preflightId: randomUUID(),
});

function mockedRecovery(override: "owner" | "advisory" | "blockers" | "count" | null = null) {
  const original = { tenant_id: "original-user", failed_aged: true, preflight_inactive: true };
  const rows: Record<"owner" | "advisory" | "blockers" | "count", Record<string, unknown>[]> = {
    owner: [original],
    advisory: [{ acquired: true }],
    blockers: [{ held: false, erasure: false }],
    count: [{ n: 0, oldest: null }],
  };
  if (override !== null) rows[override] = [...rows[override], ...rows[override]];
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return { rows: rows.owner };
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: rows.advisory };
    if (sql.includes("AS held")) return { rows: rows.blockers };
    if (sql.includes("COUNT(*)::integer")) return { rows: rows.count };
    throw new Error("Unexpected SQL in recovery fixture");
  });
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  return { db: { withTransaction } as never, query };
}

describe("original USER private reader recovery SQL result integrity", () => {
  it.each(["owner", "advisory", "blockers", "count"] as const)(
    "denies recovery status based on ambiguous %s result rows",
    async (table) => {
      const fixture = mockedRecovery(table);
      expect(await assessHistoricalUserPrivateReadRecovery({ ...inputBase(), db: fixture.db })).toEqual({
        status: "unverified",
        releaseAllowed: false,
      });
    },
  );

  it("reports zero unresolved readers only from exact single authoritative rows", async () => {
    const fixture = mockedRecovery();
    expect(await assessHistoricalUserPrivateReadRecovery({ ...inputBase(), db: fixture.db })).toEqual({
      status: "no_unresolved",
      releaseAllowed: false,
      unresolvedReaders: 0,
    });
    expect(fixture.query).toHaveBeenCalledTimes(5);
  });
});
