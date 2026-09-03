import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as webhookPost } from "../../../apps/web/app/api/v1/billing/webhook/route.js";
import * as pgExecutorModule from "../../../packages/db/src/pg-executor.js";

const trackedEnvironmentNames = [
  "STRIPE_WEBHOOK_SECRET",
  "BOARDREADYOPS_PERSISTENCE_MODE",
  "DATABASE_URL",
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

const webhookSecret = "whsec_test_secret_1234567890";

function signedRequest(payload: Record<string, unknown>, timestamp = Math.floor(Date.now() / 1000)): Request {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://boardreadyops.com/api/v1/billing/webhook", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${digest}` },
  });
}

function stripeEvent(id: string, type: string, object: Record<string, unknown>): Record<string, unknown> {
  return { id, type, created: Math.floor(Date.now() / 1000), data: { object } };
}

function subscriptionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    quantity: 1,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_team_month" } }] },
    ...overrides,
  };
}

/** Queues DB responses for postgres mode and returns the mocked `query` fn. */
function postgresMode(...responses: Array<Record<string, unknown>>): ReturnType<typeof vi.fn> {
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_biz_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_biz_year";
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const close = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(pgExecutorModule, "createPgQueryExecutor").mockReturnValue({ query, close } as never);
  return query;
}

const recordedEventRow = { rows: [{ id: "ev_1", type: "x", tenant_id: null, processed_at: null, created_at: "" }] };
const markedProcessed = { rows: [] };

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("POST /api/v1/billing/webhook -- Stripe entitlement projection", () => {
  it("links a Stripe customer id to a tenant on checkout.session.completed", async () => {
    const query = postgresMode(
      recordedEventRow,
      {
        rows: [
          {
            id: "cust_1",
            tenant_id: "octo-org",
            stripe_customer_id: "cus_123",
            tier: "free",
            status: "incomplete",
            trial_ends_at: null,
            grace_ends_at: null,
            current_period_end: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      markedProcessed,
    );

    const response = await webhookPost(
      signedRequest(
        stripeEvent("evt_checkout_1", "checkout.session.completed", {
          customer: "cus_123",
          client_reference_id: "octo-org",
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      entitlement: "linked",
      tenantId: "octo-org",
    });
    expect(query).toHaveBeenCalledTimes(3);
    const [linkSql] = query.mock.calls[1] as [string, unknown[]];
    expect(linkSql).toContain("INSERT INTO billing_customers");
  });

  it("grants team entitlement from customer.subscription.created and mirrors it onto installations", async () => {
    const query = postgresMode(recordedEventRow, { rows: [{ tenant_id: "octo-org", applied: true }] }, markedProcessed);

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_sub_created_1", "customer.subscription.created", subscriptionObject())),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      entitlement: "applied",
      tenantId: "octo-org",
      tier: "team",
    });
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("UPDATE installations SET plan_tier = $5");
    expect(params[4]).toBe("team");
    expect(params[6]).toBe("active");
  });

  it("projects a trialing subscription with trial_end onto billing_customers.status", async () => {
    const query = postgresMode(recordedEventRow, { rows: [{ tenant_id: "octo-org", applied: true }] }, markedProcessed);

    const response = await webhookPost(
      signedRequest(
        stripeEvent(
          "evt_sub_trial_1",
          "customer.subscription.created",
          subscriptionObject({ status: "trialing", trial_end: 1_701_000_000 }),
        ),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: true, entitlement: "applied" });
    const [, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params[6]).toBe("trialing"); // billing_subscriptions.status (raw Stripe status)
    expect(params[12]).toBe("trialing"); // billing_customers.status (mapped)
    expect(params[13]).toBe(new Date(1_701_000_000 * 1000).toISOString()); // trial_ends_at
  });

  it("downgrades to free on customer.subscription.deleted", async () => {
    const query = postgresMode(recordedEventRow, { rows: [{ tenant_id: "octo-org", applied: true }] }, markedProcessed);

    const response = await webhookPost(
      signedRequest(
        stripeEvent("evt_sub_deleted_1", "customer.subscription.deleted", subscriptionObject({ status: "canceled" })),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      entitlement: "applied",
      tier: "free",
    });
    const [, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params[4]).toBe("free");
    expect(params[12]).toBe("canceled");
  });

  it("ignores a subscription event for a price id with no configured tier mapping", async () => {
    const query = postgresMode(recordedEventRow, markedProcessed);

    const response = await webhookPost(
      signedRequest(
        stripeEvent(
          "evt_sub_unmapped_1",
          "customer.subscription.updated",
          subscriptionObject({ items: { data: [{ price: { id: "price_unknown" } }] } }),
        ),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      entitlement: "ignored",
      reason: "unmapped_stripe_price",
      stripePriceId: "price_unknown",
    });
    expect(query).toHaveBeenCalledTimes(2); // recordEvent + markEventProcessed only, no projection write
  });

  it("defers projection when the subscription's Stripe customer has not been linked to a tenant yet", async () => {
    const query = postgresMode(recordedEventRow, { rows: [{ tenant_id: null, applied: false }] }, markedProcessed);

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_sub_unlinked_1", "customer.subscription.updated", subscriptionObject())),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      entitlement: "deferred",
      reason: "customer_not_linked",
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("applies a grace period on invoice.payment_failed", async () => {
    const query = postgresMode(
      recordedEventRow,
      { rows: [{ tenant_id: "octo-org" }] },
      markedProcessed,
      markedProcessed,
    );

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_invoice_failed_1", "invoice.payment_failed", { customer: "cus_123" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      entitlement: "grace_applied",
      tenantId: "octo-org",
    });
    expect(query).toHaveBeenCalledTimes(4);
    const [graceSql, graceParams] = query.mock.calls[2] as [string, unknown[]];
    expect(graceSql).toContain("status='past_due'");
    expect(graceParams[0]).toBe("octo-org");
  });

  it("does not apply a grace period when the invoice's customer is unlinked", async () => {
    const query = postgresMode(recordedEventRow, { rows: [] }, markedProcessed);

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_invoice_failed_2", "invoice.payment_failed", { customer: "cus_unlinked" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: true,
      entitlement: "deferred",
      reason: "customer_not_linked",
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("clears the grace period on invoice.paid", async () => {
    const query = postgresMode(
      recordedEventRow,
      { rows: [{ tenant_id: "octo-org" }] },
      markedProcessed,
      markedProcessed,
    );

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_invoice_paid_1", "invoice.paid", { customer: "cus_123" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      entitlement: "grace_cleared",
      tenantId: "octo-org",
    });
    const [clearSql] = query.mock.calls[2] as [string, unknown[]];
    expect(clearSql).toContain("status='active'");
    expect(clearSql).toContain("grace_ends_at=NULL");
  });

  it("stays idempotent on a redelivered event id regardless of event type", async () => {
    const query = postgresMode({ rows: [] }); // ON CONFLICT DO NOTHING -> no row -> duplicate

    const response = await webhookPost(
      signedRequest(stripeEvent("evt_sub_created_1", "customer.subscription.created", subscriptionObject())),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(query).toHaveBeenCalledTimes(1); // no projection or markEventProcessed call for a duplicate
  });
});
