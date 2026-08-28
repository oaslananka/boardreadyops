import { describe, expect, it, vi } from "vitest";
import { BillingStore } from "../../../packages/db/src/billing-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

describe("BillingStore atomic Marketplace processing", () => {
  it("persists delivery and Marketplace account state in one retry-safe statement", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ inserted: true, state_changed: true, stale: false }],
    });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);
    const processMarketplaceEvent = (
      store as unknown as {
        processMarketplaceEvent(input: Record<string, unknown>): Promise<unknown>;
      }
    ).processMarketplaceEvent;

    expect(typeof processMarketplaceEvent).toBe("function");

    await processMarketplaceEvent.call(store, {
      deliveryId: "delivery-atomic-1",
      action: "purchased",
      githubAccountId: 999,
      accountLogin: "octo-org",
      accountType: "Organization",
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-28T00:00:00Z",
      payload: { action: "purchased" },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WITH inserted_event AS");
    expect(sql).toContain("ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING");
    expect(sql).toContain("github_marketplace_subscriptions");
    expect(sql).toContain("EXCLUDED.effective_at > github_marketplace_subscriptions.effective_at");
    expect(sql).toContain("EXCLUDED.effective_at = github_marketplace_subscriptions.effective_at");
    expect(sql).toContain("OR EXCLUDED.status = 'canceled'");
    expect(sql).toContain("ON CONFLICT (tenant_id, scope)");
    expect(sql).toContain("requested_by = 'github_marketplace'");
    expect(sql).toContain("scope IN ('organization', 'user')");
    expect(sql).toContain("scope = $16::text");
    expect(sql).toContain("status IN ('pending', 'running', 'blocked_by_hold')");
    expect(sql).toContain("DO NOTHING");
    expect(sql).toContain("processed_at");
    expect(sql).toContain("UPDATE api_tokens");
    expect(sql).toContain("FROM repositories");
    expect(sql).toContain("JOIN installations");
    expect(params).toContain(999);
    expect(params).toContain("free");
    expect(params.at(-1)).toBe("organization");
    expect(sql).toContain("WHEN $16::text = 'user' THEN (SELECT tenant_id FROM resolved_erasure_tenant)");
  });

  it("does not write Stripe customer or installation entitlement state", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ inserted: true, state_changed: true, stale: false }],
    });
    const store = new BillingStore({ query } as unknown as SqlQueryExecutor);
    const processMarketplaceEvent = (
      store as unknown as {
        processMarketplaceEvent(input: Record<string, unknown>): Promise<unknown>;
      }
    ).processMarketplaceEvent;

    expect(typeof processMarketplaceEvent).toBe("function");
    await processMarketplaceEvent.call(store, {
      deliveryId: "delivery-isolated-1",
      action: "cancelled",
      githubAccountId: 999,
      accountLogin: "octo-org",
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-29T00:00:00Z",
      payload: { action: "cancelled" },
    });

    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).not.toContain("UPDATE billing_customers");
    expect(sql).not.toContain("INSERT INTO billing_customers");
    expect(sql).not.toContain("UPDATE installations SET plan_tier");
  });
});
