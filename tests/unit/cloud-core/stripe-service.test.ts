import { afterEach, describe, expect, it } from "vitest";
import {
  getStripePriceConfig,
  handledStripeEventTypes,
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
