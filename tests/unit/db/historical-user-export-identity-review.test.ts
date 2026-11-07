import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserExportIdentityReview } from "../../../packages/db/src/data-export-historical-export-identity-review.js";

const exportId = randomUUID();
const verifiedGitHubUserId = 945_107_123;
const authority = { exportId, verifiedGitHubUserId };
const valid = {
  export_id: exportId,
  retained_suspended_installation: true,
  candidate_count: 6,
  attributed_same_login_count: 2,
  same_numeric_id_other_login_count: 1,
  legacy_login_only_count: 1,
  foreign_numeric_id_same_login_count: 1,
};
function fixture(result: unknown = { rows: [valid] }) {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => result);
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

describe("original numeric GitHub USER unlinked lifecycle export ownership review", () => {
  it("separates numeric identity, login alias, unbound legacy and recycled-login records without customer grant", async () => {
    const fake = fixture();
    const result = await assessHistoricalUserExportIdentityReview(fake.db, authority);
    expect(result).toEqual({
      status: "historical-export-identity-review-only",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      attributedSameLoginCount: 2,
      sameNumericIdOtherLoginCount: 1,
      legacyLoginOnlyCount: 1,
      foreignNumericIdSameLoginCount: 1,
      otherSameLoginCount: 1,
      candidateCount: 6,
      independentOwnershipComplete: false,
    });
    expect(fake.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(fake.query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [exportId, verifiedGitHubUserId]);
    const sql = fake.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("installations.account_user_id");
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain("download_url");
    expect(sql).not.toContain("prepared_manifest");
    expect(sql).toContain("LIMIT 101");
  });

  it("freezes the original numeric USER and export binding before asynchronous SQL", async () => {
    const fake = fixture();
    const mutable = { ...authority };
    fake.withTransaction.mockImplementationOnce(async (work) => {
      mutable.verifiedGitHubUserId = 999;
      mutable.exportId = randomUUID();
      return work({ query: fake.query });
    });
    expect(await assessHistoricalUserExportIdentityReview(fake.db, mutable)).toMatchObject({
      attributedSameLoginCount: 2,
      customerDeliveryAllowed: false,
    });
    expect(fake.query.mock.calls[0]?.[1]).toEqual([exportId, verifiedGitHubUserId]);
  });

  it("denies invalid UUID/user input before touching the database", async () => {
    const fake = fixture();
    expect(await assessHistoricalUserExportIdentityReview(fake.db, { ...authority, exportId: "not-uuid" })).toBeNull();
    expect(
      await assessHistoricalUserExportIdentityReview(fake.db, { ...authority, verifiedGitHubUserId: 0 }),
    ).toBeNull();
    expect(
      await assessHistoricalUserExportIdentityReview(fake.db, { ...authority, verifiedGitHubUserId: 1.5 }),
    ).toBeNull();
    expect(await assessHistoricalUserExportIdentityReview(null as never, authority)).toBeNull();
    expect(fake.withTransaction).not.toHaveBeenCalled();
  });

  it("denies missing original-account export, suspended installation or ambiguous duplicate rows", async () => {
    for (const response of [
      { rows: [] },
      { rows: [{ ...valid, retained_suspended_installation: false }] },
      { rows: [{ ...valid, export_id: randomUUID() }] },
      { rows: [valid, valid] },
      { rows: [null] },
      { rows: [[]] },
      { rows: ["unexpected"] },
      { notRows: [] },
      null,
    ]) {
      expect(await assessHistoricalUserExportIdentityReview(fixture(response).db, authority)).toBeNull();
    }
  });

  it("denies malformed or unbounded aggregate counts", async () => {
    for (const changed of [
      { candidate_count: 101 },
      { candidate_count: 0 },
      { attributed_same_login_count: 0 },
      { legacy_login_only_count: -1 },
      { foreign_numeric_id_same_login_count: 1.5 },
      { same_numeric_id_other_login_count: "1" },
      { candidate_count: 3 },
      { attributed_same_login_count: 101 },
    ]) {
      expect(
        await assessHistoricalUserExportIdentityReview(fixture({ rows: [{ ...valid, ...changed }] }).db, authority),
      ).toBeNull();
    }
  });

  it("does not require a legacy or cross-user conflict when the only valid candidate is the original export", async () => {
    const result = await assessHistoricalUserExportIdentityReview(
      fixture({
        rows: [
          {
            ...valid,
            candidate_count: 1,
            attributed_same_login_count: 1,
            same_numeric_id_other_login_count: 0,
            legacy_login_only_count: 0,
            foreign_numeric_id_same_login_count: 0,
          },
        ],
      }).db,
      authority,
    );
    expect(result).toMatchObject({
      candidateCount: 1,
      legacyLoginOnlyCount: 0,
      foreignNumericIdSameLoginCount: 0,
      independentOwnershipComplete: false,
    });
  });

  it("fails closed on an unavailable or invalid PostgreSQL response", async () => {
    const fake = fixture();
    fake.query.mockRejectedValueOnce(new Error("statement timeout"));
    expect(await assessHistoricalUserExportIdentityReview(fake.db, authority)).toBeNull();
    fake.withTransaction.mockRejectedValueOnce(new Error("read-only transaction cannot start"));
    expect(await assessHistoricalUserExportIdentityReview(fake.db, authority)).toBeNull();
  });
});
