import { afterEach, describe, expect, it } from "vitest";
import {
  billingCustomerStatusFromStripeStatus,
  getStripePriceConfig,
  handledStripeEventTypes,
  parseStripeCheckoutSessionCompleted,
  parseStripeInvoiceEvent,
  parseStripeSubscriptionEvent,
  resolveIntervalFromPriceId,
  resolveTierFromPriceId,
  type StripePriceConfig,
} from "../../../packages/cloud-core/src/stripe-service.js";

const PRICE_ENV_KEYS = [
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of PRICE_ENV_KEYS) originalEnv[key] = process.env[key];

afterEach(() => {
  for (const key of PRICE_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("getStripePriceConfig", () => {
  it("returns null when the required team/business monthly price ids are not configured", () => {
    for (const key of PRICE_ENV_KEYS) delete process.env[key];
    expect(getStripePriceConfig()).toBeNull();
  });

  it("returns the full config once team and business monthly price ids are set", () => {
    process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
    process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
    process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_biz_month";
    process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_biz_year";

    expect(getStripePriceConfig()).toEqual({
      teamMonthlyPriceId: "price_team_month",
      teamYearlyPriceId: "price_team_year",
      businessMonthlyPriceId: "price_biz_month",
      businessYearlyPriceId: "price_biz_year",
    });
  });
});

const config: StripePriceConfig = {
  teamMonthlyPriceId: "price_team_month",
  teamYearlyPriceId: "price_team_year",
  businessMonthlyPriceId: "price_biz_month",
  businessYearlyPriceId: "price_biz_year",
};

describe("resolveTierFromPriceId", () => {
  it("maps a team price id (monthly or yearly) to the team tier", () => {
    expect(resolveTierFromPriceId("price_team_month", config)).toBe("team");
    expect(resolveTierFromPriceId("price_team_year", config)).toBe("team");
  });

  it("maps a business price id to the business tier", () => {
    expect(resolveTierFromPriceId("price_biz_month", config)).toBe("business");
  });

  it("returns null for a price id from no known tier", () => {
    expect(resolveTierFromPriceId("price_unknown", config)).toBeNull();
  });
});

describe("resolveIntervalFromPriceId", () => {
  it("maps monthly price ids to month and yearly price ids to year", () => {
    expect(resolveIntervalFromPriceId("price_team_month", config)).toBe("month");
    expect(resolveIntervalFromPriceId("price_biz_year", config)).toBe("year");
  });

  it("returns null for a price id from no known interval", () => {
    expect(resolveIntervalFromPriceId("price_unknown", config)).toBeNull();
  });
});

describe("handledStripeEventTypes", () => {
  it("covers exactly the lifecycle events the webhook route processes", () => {
    expect(handledStripeEventTypes.has("checkout.session.completed")).toBe(true);
    expect(handledStripeEventTypes.has("invoice.payment_failed")).toBe(true);
    expect(handledStripeEventTypes.has("charge.dispute.created")).toBe(false);
  });
});

describe("billingCustomerStatusFromStripeStatus", () => {
  it("maps trialing, active, past_due and incomplete straight through", () => {
    expect(billingCustomerStatusFromStripeStatus("trialing")).toBe("trialing");
    expect(billingCustomerStatusFromStripeStatus("active")).toBe("active");
    expect(billingCustomerStatusFromStripeStatus("past_due")).toBe("past_due");
    expect(billingCustomerStatusFromStripeStatus("incomplete")).toBe("incomplete");
  });

  it("fails safe to canceled for every Stripe end-state and any unrecognised status", () => {
    expect(billingCustomerStatusFromStripeStatus("canceled")).toBe("canceled");
    expect(billingCustomerStatusFromStripeStatus("unpaid")).toBe("canceled");
    expect(billingCustomerStatusFromStripeStatus("incomplete_expired")).toBe("canceled");
    expect(billingCustomerStatusFromStripeStatus("paused")).toBe("canceled");
    expect(billingCustomerStatusFromStripeStatus("some_future_stripe_status")).toBe("canceled");
  });
});

describe("parseStripeCheckoutSessionCompleted", () => {
  it("extracts the Stripe customer id and this repo's tenant id from client_reference_id", () => {
    expect(parseStripeCheckoutSessionCompleted({ customer: "cus_123", client_reference_id: "octo-org" })).toEqual({
      stripeCustomerId: "cus_123",
      tenantId: "octo-org",
    });
  });

  it("returns undefined when customer or client_reference_id is missing", () => {
    expect(parseStripeCheckoutSessionCompleted({ customer: "cus_123" })).toBeUndefined();
    expect(parseStripeCheckoutSessionCompleted({ client_reference_id: "octo-org" })).toBeUndefined();
    expect(parseStripeCheckoutSessionCompleted(null)).toBeUndefined();
    expect(parseStripeCheckoutSessionCompleted(undefined)).toBeUndefined();
    expect(parseStripeCheckoutSessionCompleted("not-an-object")).toBeUndefined();
  });
});

function sampleSubscriptionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    quantity: 3,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_team_month" } }] },
    ...overrides,
  };
}

describe("parseStripeSubscriptionEvent", () => {
  it("parses a well-formed subscription object", () => {
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject())).toEqual({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      stripePriceId: "price_team_month",
      status: "active",
      quantity: 3,
      currentPeriodStart: new Date(1_700_000_000 * 1000).toISOString(),
      currentPeriodEnd: new Date(1_702_592_000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: undefined,
    });
  });

  it("parses trial_end into trialEndsAt when present", () => {
    const parsed = parseStripeSubscriptionEvent(sampleSubscriptionObject({ trial_end: 1_701_000_000 }));
    expect(parsed?.trialEndsAt).toBe(new Date(1_701_000_000 * 1000).toISOString());
  });

  it("defaults quantity to 1 when missing or non-positive", () => {
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ quantity: undefined }))?.quantity).toBe(1);
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ quantity: 0 }))?.quantity).toBe(1);
  });

  it("returns undefined when a required field is missing", () => {
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ customer: undefined }))).toBeUndefined();
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ id: undefined }))).toBeUndefined();
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ status: undefined }))).toBeUndefined();
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ items: { data: [] } }))).toBeUndefined();
    expect(parseStripeSubscriptionEvent(sampleSubscriptionObject({ current_period_start: undefined }))).toBeUndefined();
    expect(parseStripeSubscriptionEvent(null)).toBeUndefined();
  });
});

describe("parseStripeInvoiceEvent", () => {
  it("extracts the Stripe customer id", () => {
    expect(parseStripeInvoiceEvent({ customer: "cus_123" })).toEqual({ stripeCustomerId: "cus_123" });
  });

  it("returns undefined without a customer id", () => {
    expect(parseStripeInvoiceEvent({})).toBeUndefined();
    expect(parseStripeInvoiceEvent(null)).toBeUndefined();
  });
});
