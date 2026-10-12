import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as webhookPost } from "../../../apps/web/app/api/v1/billing/webhook/route.js";
import { projectEntitlement } from "../../../apps/web/lib/stripe-entitlement-projection.js";
import { BillingStore } from "../../../packages/db/src/billing-store.js";
import * as pgExecutorModule from "../../../packages/db/src/pg-executor.js";

const environmentNames = [
  "STRIPE_WEBHOOK_SECRET",
  "BOARDREADYOPS_PERSISTENCE_MODE",
  "DATABASE_URL",
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
] as const;
const originals = new Map(environmentNames.map((name) => [name, process.env[name]]));
const secret = "whsec_synthetic_test";
const now = Math.floor(Date.now() / 1_000);

function event(id: string, type: string, object: Record<string, unknown>) {
  return { id, type, created: now, data: { object } };
}
function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_synthetic",
    customer: "cus_synthetic",
    status: "active",
    quantity: 1,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_team_month" } }] },
    ...overrides,
  };
}
function signedRequest(payload: object, signature = true): Request {
  const body = JSON.stringify(payload);
  const hash = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
  return new Request("https://boardreadyops.com/api/v1/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature ? `t=${now},v1=${hash}` : "bad" },
  });
}
function db(...values: unknown[]) {
  const query = vi.fn();
  for (const value of values) query.mockResolvedValueOnce(value);
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.DATABASE_URL = "postgresql://localhost:5432/synthetic";
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
  vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({
    query,
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
  return query;
}
afterEach(() => {
  for (const name of environmentNames) {
    const original = originals.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  vi.restoreAllMocks();
});

describe("verified Stripe inbox HTTP boundary", () => {
  it("rejects an oversized request before DB access", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const response = await webhookPost(
      new Request("https://boardreadyops.com/api/v1/billing/webhook", {
        method: "POST",
        body: "a".repeat(1024 * 1024 + 1),
        headers: { "stripe-signature": "bad" },
      }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects an invalid signature without recording", async () => {
    const query = db();
    expect((await webhookPost(signedRequest(event("evt_bad", "invoice.paid", {}), false))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("durably records an event and returns promptly without projecting entitlements", async () => {
    const query = db({ rows: [{ id: "id", stripe_event_id: "evt_1", type: "invoice.paid" }] });
    const response = await webhookPost(signedRequest(event("evt_1", "invoice.paid", { customer: "cus_synthetic" })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, received: true, duplicate: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain("INSERT INTO billing_events");
  });

  it("acknowledges a redelivery without invoking a second projection", async () => {
    const query = db({ rows: [] });
    const response = await webhookPost(signedRequest(event("evt_dupe", "invoice.paid", {})));
    await expect(response.json()).resolves.toEqual({ ok: true, received: true, duplicate: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails closed if persistence is unavailable", async () => {
    const query = db();
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    const response = await webhookPost(signedRequest(event("evt_memory", "invoice.paid", {})));
    expect(response.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not acknowledge a failed durable insert", async () => {
    const query = db();
    query.mockRejectedValueOnce(new Error("synthetic database outage"));
    await expect(webhookPost(signedRequest(event("evt_outage", "invoice.paid", {})))).rejects.toThrow(
      "synthetic database outage",
    );
  });
});

describe("transactional Stripe projection units", () => {
  it("links checkout ownership and wakes, but never replays in the same HTTP request", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cust_1",
            tenant_id: "tenant_1",
            stripe_customer_id: "cus_synthetic",
            tier: "free",
            status: "incomplete",
            trial_ends_at: null,
            grace_ends_at: null,
            current_period_end: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const store = new BillingStore({ query });
    await expect(
      projectEntitlement(
        store,
        event("evt_checkout", "checkout.session.completed", {
          customer: "cus_synthetic",
          client_reference_id: "tenant_1",
        }),
      ),
    ).resolves.toEqual({ entitlement: "linked", tenantId: "tenant_1" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("available_at=NOW()");
  });

  it("projects a subscription and retains the repository entitlement mirror", async () => {
    process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
    process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
    process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
    process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
    process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
    process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
    process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
    const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: "tenant_1", applied: true }] });
    const result = await projectEntitlement(
      new BillingStore({ query }),
      event("evt_subscription", "customer.subscription.created", subscription()),
    );
    expect(result).toMatchObject({ entitlement: "applied", tenantId: "tenant_1", tier: "team" });
    expect(String(query.mock.calls[0]?.[0])).toContain("UPDATE installations SET plan_tier = $5");
  });

  it("does not mark unmapped prices processed before configuration is fixed", async () => {
    process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
    process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
    process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
    process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
    process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
    process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
    process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
    const query = vi.fn();
    const result = await projectEntitlement(
      new BillingStore({ query }),
      event(
        "evt_unknown_price",
        "customer.subscription.updated",
        subscription({ items: { data: [{ price: { id: "price_new" } }] } }),
      ),
    );
    expect(result).toMatchObject({ entitlement: "deferred", reason: "unmapped_stripe_price" });
    expect(query).not.toHaveBeenCalled();
  });

  it("sends invoice event timestamps to the monotonic guard", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant_1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "cust_1" }] });
    const result = await projectEntitlement(
      new BillingStore({ query }),
      event("evt_invoice", "invoice.payment_failed", { customer: "cus_synthetic" }),
    );
    expect(result).toMatchObject({ entitlement: "grace_applied", tenantId: "tenant_1" });
    expect(String(query.mock.calls[1]?.[0])).toContain("last_invoice_event_created_at");
  });

  it("leaves unlinked invoice events pending for later checkout", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await projectEntitlement(
      new BillingStore({ query }),
      event("evt_unlinked", "invoice.paid", { customer: "cus_unknown" }),
    );
    expect(result).toMatchObject({ entitlement: "deferred", reason: "customer_not_linked" });
  });
});
