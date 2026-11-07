import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserHardwareOwnedRowCounts } from "../../../packages/db/src/data-export-historical-hardware-owner-counts.js";

const exportId = randomUUID();
const originalUserId = 9_273_841_733;
const identity = () => ({ exportId, verifiedGitHubUserId: originalUserId });
const sourceKeys = [
  "boards",
  "boardBomSnapshots",
  "boardBomComponents",
  "firmwareSnapshots",
  "firmwareDependencies",
  "firmwareAdvisoryWatch",
  "runPcbFootprintSummaries",
  "boardSupplyWatch",
  "boardSupplyFindings",
  "productionBatches",
  "productionBatchDefects",
  "releaseRunAttempts",
  "releaseRunResults",
  "releaseRunTransitionEvents",
] as const;
const validRow = () => ({
  export_id: exportId,
  ...Object.fromEntries(sourceKeys.map((key) => [key, 2])),
  foreignBomRunMismatch: 0,
  foreignFirmwareRunMismatch: 0,
  foreignFootprintRunMismatch: 0,
  foreignResultAttemptMismatch: 0,
  foreignTransitionScopeMismatch: 0,
});
const fake = (returned: unknown) => {
  const query = vi.fn(async (_sql: string, _args: unknown[]) => ({ rows: returned }));
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
};

describe("source-only original numeric USER hardware ownership COUNT gate", () => {
  it("requires an original numeric USER and a valid export ID before any SQL", async () => {
    const db = fake([validRow()]);
    expect(
      await assessHistoricalUserHardwareOwnedRowCounts(db.db, {
        exportId,
        verifiedGitHubUserId: -1,
      }),
    ).toBeNull();
    expect(
      await assessHistoricalUserHardwareOwnedRowCounts(db.db, {
        exportId: "foreign",
        verifiedGitHubUserId: originalUserId,
      }),
    ).toBeNull();
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("counts only source candidates from locked original USER joins and never grants rights", async () => {
    const db = fake([validRow()]);
    const candidate = await assessHistoricalUserHardwareOwnedRowCounts(db.db, identity());
    expect(candidate).toEqual({
      scope: "original-numeric-user-retained-suspended-installation-only",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      rowCounts: Object.fromEntries(sourceKeys.map((key) => [key, 2])),
    });
    expect(db.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    const sql = db.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("account_user_id=owner_export.original_github_user_id");
    expect(sql).toContain("WHERE EXISTS (SELECT 1 FROM former_installations)");
    expect(sql).toContain("hold.active=TRUE");
    expect(sql).toContain("erasure.status IN ('running','completed')");
    expect(sql).toContain("run.repository_id=b.repository_id");
    expect(sql).toContain("public.production_batch_defects");
    expect(sql).toContain("public.release_run_transition_events");
    expect(sql).toContain('AS "foreignResultAttemptMismatch"');
    expect(sql).toContain('AS "foreignTransitionScopeMismatch"');
    expect(sql).toContain("LIMIT 101");
    expect(sql).not.toContain("SELECT *");
    expect(db.query.mock.calls[0]?.[1]).toEqual([exportId, originalUserId]);
  });

  it.each([
    ["missing", []],
    ["ambiguous owner rows", [validRow(), validRow()]],
    ["wrong export", [{ ...validRow(), export_id: randomUUID() }]],
    ["null", [null]],
    ["negative", [{ ...validRow(), boards: -1 }]],
    ["unbounded", [{ ...validRow(), boardBomComponents: 101 }]],
    ["forged string", [{ ...validRow(), firmwareSnapshots: "2" }]],
    ["cross tenant BOM", [{ ...validRow(), foreignBomRunMismatch: 1 }]],
    ["cross tenant firmware", [{ ...validRow(), foreignFirmwareRunMismatch: 1 }]],
    ["cross tenant footprint", [{ ...validRow(), foreignFootprintRunMismatch: 1 }]],
    ["cross tenant result attempt", [{ ...validRow(), foreignResultAttemptMismatch: 1 }]],
    ["cross tenant transition", [{ ...validRow(), foreignTransitionScopeMismatch: 1 }]],
    ["missing supply class", [{ ...validRow(), boardSupplyWatch: undefined }]],
    ["unbounded manufacturing", [{ ...validRow(), productionBatchDefects: 101 }]],
    ["missing class", [{ ...validRow(), firmwareAdvisoryWatch: undefined }]],
    ["unparseable", { length: 1 }],
  ])("fails closed on %s", async (_, rows) => {
    expect(await assessHistoricalUserHardwareOwnedRowCounts(fake(rows).db, identity())).toBeNull();
  });

  it("refuses an unavailable database transaction", async () => {
    const db = { withTransaction: vi.fn().mockRejectedValue(new Error("database offline")) };
    expect(await assessHistoricalUserHardwareOwnedRowCounts(db as never, identity())).toBeNull();
  });
});
