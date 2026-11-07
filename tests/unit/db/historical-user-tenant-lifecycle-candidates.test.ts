import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserTenantOnlyLifecycleCandidates } from "../../../packages/db/src/data-export-historical-tenant-lifecycle-candidates.js";

const exportId = randomUUID();
const originalId = 9_105_123_556;
const owner = { exportId, verifiedGitHubUserId: originalId };
const sample = {
  export_id: exportId,
  retained_suspended_installation: true,
  competing_or_unbound_installation_identity: true,
  retention_policies: 1,
  legal_holds: 2,
  erasure_requests: 3,
  product_events: 4,
};
function fakeDb(response: unknown = { rows: [sample] }) {
  const query = vi.fn(async (_sql: string, _args: unknown[]): Promise<unknown> => response);
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

describe("four unlinked tenant-login lifecycle classes never establish original USER ownership", () => {
  it("reports bounded counts and competing user identity without granting any customer delivery", async () => {
    const fake = fakeDb();
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, owner)).toEqual({
      status: "tenant-login-lifecycle-candidates-unattributable",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 4,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tenantLoginAloneProvesNothing: true,
      competingOrUnboundInstallationIdentity: true,
      loginOnlyCandidateCounts: {
        retentionPolicies: 1,
        legalHolds: 2,
        erasureRequests: 3,
        productEvents: 4,
      },
    });
    expect(fake.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(fake.query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [exportId, originalId]);
    const sql = fake.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("former_installations");
    expect(sql).toContain("IS DISTINCT FROM target.original_github_user_id");
    for (const table of ["retention_policies", "legal_holds", "erasure_requests", "product_events"]) {
      expect(sql).toContain(["public.", table].join(""));
    }
    expect(sql.match(/LIMIT 101/gu)).toHaveLength(4);
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain("SELECT p.id");
    expect(sql).not.toContain("metadata");
    expect(sql).not.toContain("download_url");
  });

  it("does not infer ownership when no collision is visible and all four counts are zero", async () => {
    const row = {
      ...sample,
      competing_or_unbound_installation_identity: false,
      retention_policies: 0,
      legal_holds: 0,
      erasure_requests: 0,
      product_events: 0,
    };
    const result = await assessHistoricalUserTenantOnlyLifecycleCandidates(fakeDb({ rows: [row] }).db, owner);
    expect(result).toMatchObject({
      competingOrUnboundInstallationIdentity: false,
      originalUserOwnershipVerified: false,
      tenantLoginAloneProvesNothing: true,
      customerDeliveryAllowed: false,
      loginOnlyCandidateCounts: {
        retentionPolicies: 0,
        legalHolds: 0,
        erasureRequests: 0,
        productEvents: 0,
      },
    });
  });

  it("freezes mutable caller credentials before the PostgreSQL transaction", async () => {
    const mutated = { ...owner };
    const fake = fakeDb();
    fake.withTransaction.mockImplementationOnce(async (fn) => {
      mutated.exportId = randomUUID();
      mutated.verifiedGitHubUserId = 3;
      return fn({ query: fake.query });
    });
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, mutated)).toMatchObject({
      customerDeliveryAllowed: false,
    });
    expect(fake.query.mock.calls[0]?.[1]).toEqual([exportId, originalId]);
  });

  it("rejects invalid identity and absent adapter before a database query", async () => {
    const fake = fakeDb();
    expect(
      await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, { ...owner, exportId: "wrong" }),
    ).toBeNull();
    expect(
      await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, { ...owner, verifiedGitHubUserId: 0 }),
    ).toBeNull();
    expect(
      await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, { ...owner, verifiedGitHubUserId: 1.7 }),
    ).toBeNull();
    expect(
      await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, {
        ...owner,
        verifiedGitHubUserId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(null as never, owner)).toBeNull();
    expect(fake.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid or absent source authority even when count columns appear valid", async () => {
    for (const response of [
      null,
      { foo: "rows" },
      { rows: [] },
      { rows: [sample, sample] },
      { rows: [null] },
      { rows: [[]] },
      { rows: [{ ...sample, export_id: randomUUID() }] },
      { rows: [{ ...sample, retained_suspended_installation: false }] },
      { rows: [{ ...sample, competing_or_unbound_installation_identity: null }] },
    ]) {
      expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fakeDb(response).db, owner)).toBeNull();
    }
  });

  it("fails closed if even one class count overflows, is negative or not a finite integer", async () => {
    for (const changed of [
      { retention_policies: 101 },
      { legal_holds: 101 },
      { erasure_requests: 101 },
      { product_events: 101 },
      { product_events: -1 },
      { product_events: "2" },
      { product_events: null },
      { legal_holds: Number.NaN },
      { erasure_requests: 0.3 },
    ]) {
      const fake = fakeDb({ rows: [{ ...sample, ...changed }] });
      expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, owner)).toBeNull();
    }
  });

  it("denies a timeout, transport failure or transaction failure", async () => {
    const fake = fakeDb();
    fake.query.mockRejectedValueOnce(new Error("database snapshot unavailable"));
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, owner)).toBeNull();
    fake.withTransaction.mockRejectedValueOnce(new Error("read-only transaction unavailable"));
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(fake.db, owner)).toBeNull();
  });
});
