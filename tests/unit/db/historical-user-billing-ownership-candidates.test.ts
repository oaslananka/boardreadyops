import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserBillingOwnershipCandidates } from "../../../packages/db/src/data-export-historical-billing-ownership-candidates.js";

const exportId = randomUUID();
const numericId = 9_871_240_015;
const authority = { exportId, verifiedGitHubUserId: numericId };
const sample = {
  export_id: exportId,
  has_suspended_original_user: true,
  competing_or_unbound_installation_identity: true,
  billing_customers: 1,
  billing_subscriptions: 2,
  billing_events: 3,
  billing_activity: 4,
  numeric_marketplace_count: 1,
  foreign_numeric_marketplace_same_login: 1,
  numeric_marketplace_login_changed: true,
};

function fake(response: unknown = { rows: [sample] }) {
  const query = vi.fn(async (_sql: string, _args: unknown[]): Promise<unknown> => response);
  const withTransaction = vi.fn(async (run: (tx: { query: typeof query }) => Promise<unknown>) => run({ query }));
  return { query, withTransaction, db: { withTransaction } as never };
}

describe("original numeric USER five unlinked billing source classes: no disclosure grant", () => {
  it("counts login-only records separately from exact numeric Marketplace account", async () => {
    const f = fake();
    expect(await assessHistoricalUserBillingOwnershipCandidates(f.db, authority)).toEqual({
      status: "billing-provider-and-login-candidates-unapproved",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 5,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      providerDisclosureRightsVerified: false,
      customerFinancialDataDisclosureVerified: false,
      billingEventsWithoutTenantUnresolved: true,
      competingOrUnboundInstallationIdentity: true,
      exactNumericMarketplaceAccountCount: 1,
      marketplaceSameLoginDifferentNumericAccounts: 1,
      exactNumericMarketplaceLoginChanged: true,
      loginOnlyBillingCandidateCounts: {
        customers: 1,
        subscriptions: 2,
        eventsWithTenant: 3,
        activity: 4,
      },
    });
    expect(f.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [exportId, numericId]);
    const sql = f.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("former_installations");
    expect(sql).toContain("m.github_account_id=target.original_github_user_id");
    expect(sql).toContain("m.github_account_id<>target.original_github_user_id");
    for (const table of [
      "billing_customers",
      "billing_subscriptions",
      "billing_events",
      "billing_activity",
      "github_marketplace_subscriptions",
    ])
      expect(sql).toContain(["public.", table].join(""));
    expect(sql.match(/LIMIT 101/gu)).toHaveLength(6);
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain("payload");
    expect(sql).not.toContain("stripe_customer_id");
    expect(sql).not.toContain("stripe_event_id");
    expect(sql).not.toContain("last_delivery_id");
  });

  it("reports zero evidence without treating a coincident login as original user ownership", async () => {
    const row = {
      ...sample,
      competing_or_unbound_installation_identity: false,
      billing_customers: 0,
      billing_subscriptions: 0,
      billing_events: 0,
      billing_activity: 0,
      numeric_marketplace_count: 0,
      foreign_numeric_marketplace_same_login: 0,
      numeric_marketplace_login_changed: false,
    };
    expect(await assessHistoricalUserBillingOwnershipCandidates(fake({ rows: [row] }).db, authority)).toMatchObject({
      originalUserOwnershipVerified: false,
      customerDeliveryAllowed: false,
      exactNumericMarketplaceAccountCount: 0,
      billingEventsWithoutTenantUnresolved: true,
    });
  });

  it("freezes export UUID and verified numeric GitHub ID before asynchronous work", async () => {
    const f = fake();
    const mutable = { ...authority };
    f.withTransaction.mockImplementationOnce(async (work) => {
      mutable.exportId = randomUUID();
      mutable.verifiedGitHubUserId = 1;
      return work({ query: f.query });
    });
    expect(await assessHistoricalUserBillingOwnershipCandidates(f.db, mutable)).toMatchObject({
      exactNumericMarketplaceAccountCount: 1,
      customerDeliveryAllowed: false,
    });
    expect(f.query.mock.calls[0]?.[1]).toEqual([exportId, numericId]);
  });

  it("denies malformed identity before database access", async () => {
    const f = fake();
    expect(await assessHistoricalUserBillingOwnershipCandidates(f.db, { ...authority, exportId: "bad" })).toBeNull();
    for (const bad of [0, -7, 0.3, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(
        await assessHistoricalUserBillingOwnershipCandidates(f.db, {
          ...authority,
          verifiedGitHubUserId: bad,
        }),
      ).toBeNull();
    }
    expect(await assessHistoricalUserBillingOwnershipCandidates(null as never, authority)).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });

  it("denies missing historical owner, ambiguous records and malformed result bodies", async () => {
    for (const response of [
      null,
      { anything: 1 },
      { rows: [] },
      { rows: [sample, sample] },
      { rows: [null] },
      { rows: [[]] },
      { rows: [8] },
      { rows: [{ ...sample, export_id: randomUUID() }] },
      { rows: [{ ...sample, has_suspended_original_user: false }] },
      { rows: [{ ...sample, competing_or_unbound_installation_identity: "false" }] },
      { rows: [{ ...sample, numeric_marketplace_login_changed: null }] },
    ])
      expect(await assessHistoricalUserBillingOwnershipCandidates(fake(response).db, authority)).toBeNull();
  });

  it("fails closed on a missing, negative, oversized or noninteger class count", async () => {
    for (const key of [
      "billing_customers",
      "billing_subscriptions",
      "billing_events",
      "billing_activity",
      "numeric_marketplace_count",
      "foreign_numeric_marketplace_same_login",
    ]) {
      for (const value of [null, -1, 101, 0.5, Number.NaN, "2"]) {
        expect(
          await assessHistoricalUserBillingOwnershipCandidates(
            fake({ rows: [{ ...sample, [key]: value }] }).db,
            authority,
          ),
        ).toBeNull();
      }
    }
    // Marketplace is an exact numeric-account primary key; even a forged two
    // must never pass as a legitimate one-owner account record.
    expect(
      await assessHistoricalUserBillingOwnershipCandidates(
        fake({ rows: [{ ...sample, numeric_marketplace_count: 2 }] }).db,
        authority,
      ),
    ).toBeNull();
  });

  it("denies unavailable read-only snapshot and statement failures", async () => {
    const f = fake();
    f.query.mockRejectedValueOnce(new Error("statement timeout"));
    expect(await assessHistoricalUserBillingOwnershipCandidates(f.db, authority)).toBeNull();
    f.withTransaction.mockRejectedValueOnce(new Error("unavailable"));
    expect(await assessHistoricalUserBillingOwnershipCandidates(f.db, authority)).toBeNull();
  });
});
