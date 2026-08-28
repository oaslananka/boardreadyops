import { describe, expect, it, vi } from "vitest";
import { BillingStore } from "../../../packages/db/src/billing-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

describe("BillingStore marketplace events", () => {
  it("records a marketplace event with deliveryId and returns inserted event", async () => {
    const mockRow = {
      id: "ev_123",
      provider: "github_marketplace",
      delivery_id: "del_abc",
      tenant_id: "octo-org",
      type: "marketplace_purchase.purchased",
      payload: { action: "purchased" },
      processed_at: null,
      created_at: new Date().toISOString(),
    };

    const query = vi.fn().mockResolvedValueOnce({ rows: [mockRow] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const res = await store.recordMarketplaceEvent({
      deliveryId: "del_abc",
      action: "purchased",
      tenantId: "octo-org",
      payload: { action: "purchased" },
    });

    expect(res.inserted).toBe(true);
    expect(res.event?.deliveryId).toBe("del_abc");
    expect(res.event?.provider).toBe("github_marketplace");
    expect(res.event?.type).toBe("marketplace_purchase.purchased");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO billing_events");
    expect(sql).toContain("ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING");
    expect(params[1]).toBe("del_abc");
    expect(params[2]).toBe("octo-org");
  });

  it("handles duplicate marketplace delivery idempotently", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const res = await store.recordMarketplaceEvent({
      deliveryId: "del_duplicate",
      action: "purchased",
      tenantId: "octo-org",
      payload: { action: "purchased" },
    });

    expect(res.inserted).toBe(false);
    expect(res.event).toBeNull();
  });

  it("marks a marketplace event processed by deliveryId", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    await store.markMarketplaceEventProcessed("del_abc");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE billing_events SET processed_at=NOW() WHERE delivery_id=$1");
    expect(params).toEqual(["del_abc"]);
  });

  it("applies marketplace purchase by upserting customer and updating installation plan_tier", async () => {
    const mockCustomerRow = {
      id: "cust_123",
      tenant_id: "octo-org",
      stripe_customer_id: null,
      tier: "free",
      status: "active",
      trial_ends_at: null,
      grace_ends_at: null,
      current_period_end: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockCustomerRow] })
      .mockResolvedValueOnce({ rows: [] });

    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const customer = await store.applyMarketplacePurchase({
      tenantId: "octo-org",
      tier: "free",
      status: "active",
    });

    expect(customer.tenantId).toBe("octo-org");
    expect(customer.tier).toBe("free");
    expect(customer.status).toBe("active");

    expect(query).toHaveBeenCalledTimes(2);
    const [upsertSql, upsertParams] = query.mock.calls[0] as [string, unknown[]];
    expect(upsertSql).toContain("INSERT INTO billing_customers");
    expect(upsertParams[1]).toBe("octo-org");
    expect(upsertParams[2]).toBe("free");

    const [installSql, installParams] = query.mock.calls[1] as [string, unknown[]];
    expect(installSql).toContain("UPDATE installations SET plan_tier = $1 WHERE account_login = $2");
    expect(installParams).toEqual(["free", "octo-org"]);
  });

  it("applies marketplace cancellation by downgrading customer and installation", async () => {
    const existingCustomerRow = {
      id: "cust_123",
      tenant_id: "octo-org",
      stripe_customer_id: null,
      tier: "free",
      status: "canceled",
      trial_ends_at: null,
      grace_ends_at: null,
      current_period_end: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [existingCustomerRow] })
      .mockResolvedValueOnce({ rows: [] });

    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);

    const res = await store.applyMarketplaceCancellation({
      tenantId: "octo-org",
    });

    expect(res?.status).toBe("canceled");
    expect(res?.tier).toBe("free");

    expect(query).toHaveBeenCalledTimes(2);
    const [custSql, custParams] = query.mock.calls[0] as [string, unknown[]];
    expect(custSql).toContain("UPDATE billing_customers");
    expect(custParams).toEqual(["octo-org"]);

    const [instSql, instParams] = query.mock.calls[1] as [string, unknown[]];
    expect(instSql).toContain("UPDATE installations SET plan_tier = 'free' WHERE account_login = $1");
    expect(instParams).toEqual(["octo-org"]);
  });
});
