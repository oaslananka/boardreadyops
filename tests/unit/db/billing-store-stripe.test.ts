import { describe, expect, it, vi } from "vitest";
import { BillingStore } from "../../../packages/db/src/billing-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

function customerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cust_123",
    tenant_id: "octo-org",
    stripe_customer_id: "cus_123",
    tier: "free",
    status: "incomplete",
    trial_ends_at: null,
    grace_ends_at: null,
    current_period_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("BillingStore Stripe subscription projection", () => {
  it("links a Stripe customer id to a tenant without touching an existing tier/status", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [customerRow()] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const customer = await store.linkStripeCustomer({ tenantId: "octo-org", stripeCustomerId: "cus_123" });

    expect(customer.tenantId).toBe("octo-org");
    expect(customer.stripeCustomerId).toBe("cus_123");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO billing_customers");
    expect(sql).toContain("ON CONFLICT (tenant_id) DO UPDATE SET");
    expect(sql).not.toContain("tier=EXCLUDED.tier");
    expect(params[1]).toBe("octo-org");
    expect(params[2]).toBe("cus_123");
  });

  it("resolves a tenant id from a Stripe customer id", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ tenant_id: "octo-org" }] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.resolveTenantIdByStripeCustomerId("cus_123")).resolves.toBe("octo-org");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SELECT tenant_id FROM billing_customers WHERE stripe_customer_id=$1");
    expect(params).toEqual(["cus_123"]);
  });

  it("returns null when no billing_customers row is linked to that Stripe customer id", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.resolveTenantIdByStripeCustomerId("cus_unknown")).resolves.toBeNull();
  });

  it("projects a subscription event onto billing_subscriptions, billing_customers and installations", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ tenant_id: "octo-org", applied: true }] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const result = await store.applyStripeSubscriptionEvent({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      stripePriceId: "price_team_month",
      tier: "team",
      interval: "month",
      status: "active",
      customerStatus: "active",
      quantity: 5,
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      eventCreatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({ tenantId: "octo-org", applied: true });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO billing_subscriptions");
    expect(sql).toContain("ON CONFLICT (stripe_subscription_id) DO UPDATE SET");
    expect(sql).toContain("last_event_created_at");
    expect(sql).toContain("UPDATE installations SET plan_tier = $5");
    expect(params[0]).toBe("cus_123");
    expect(params[2]).toBe("sub_123");
    expect(params[4]).toBe("team");
  });

  it("reports applied: false when the Stripe customer has not been linked to a tenant yet", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ tenant_id: null, applied: false }] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const result = await store.applyStripeSubscriptionEvent({
      stripeCustomerId: "cus_unlinked",
      stripeSubscriptionId: "sub_999",
      stripePriceId: "price_team_month",
      tier: "team",
      interval: "month",
      status: "active",
      customerStatus: "active",
      quantity: 1,
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      eventCreatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({ tenantId: null, applied: false });
  });

  it("clears grace period status back to active on payment recovery", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    await store.clearGraceOnPaymentSuccess("octo-org");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status='active'");
    expect(sql).toContain("grace_ends_at=NULL");
    expect(sql).toContain("status='past_due'");
    expect(params).toEqual(["octo-org"]);
  });
});
