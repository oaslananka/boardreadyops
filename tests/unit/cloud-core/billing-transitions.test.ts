import { describe, expect, it } from "vitest";
import {
  canWatchAnotherBoard,
  handoffLinksEnabled,
  planLimits,
  planTierOf,
  planTiers,
  supplyWatchEnabled,
} from "../../../packages/cloud-core/src/entitlements.js";
import {
  handledStripeEventTypes,
  resolveIntervalFromPriceId,
  resolveTierFromPriceId,
} from "../../../packages/cloud-core/src/stripe-service.js";
import {
  billingCustomerSchema,
  billingSubscriptionSchema,
  billingTierSchema,
} from "../../../packages/contracts/src/billing.js";

describe("Billing Contract & Tier Alignment", () => {
  it("aligns billingTierSchema with planTiers (free, team, business)", () => {
    expect(planTiers).toEqual(["free", "team", "business"]);
    expect(billingTierSchema.options).toEqual(["free", "team", "business"]);

    expect(billingTierSchema.safeParse("free").success).toBe(true);
    expect(billingTierSchema.safeParse("team").success).toBe(true);
    expect(billingTierSchema.safeParse("business").success).toBe(true);
    expect(billingTierSchema.safeParse("enterprise").success).toBe(false);
  });

  it("safely resolves plan tiers with fallback to free", () => {
    expect(planTierOf("team")).toBe("team");
    expect(planTierOf("BUSINESS")).toBe("business");
    expect(planTierOf("unknown-tier")).toBe("free");
    expect(planTierOf(null)).toBe("free");
    expect(planTierOf(undefined)).toBe("free");
  });

  it("enforces seat-based and board limits per tier", () => {
    expect(planLimits("free")).toEqual({
      watchedBoards: 1,
      evidenceRetentionDays: 30,
      supplyWatch: false,
      handoffLinks: false,
    });

    expect(planLimits("team")).toEqual({
      watchedBoards: 10,
      evidenceRetentionDays: 365,
      supplyWatch: true,
      handoffLinks: true,
    });

    expect(planLimits("business")).toEqual({
      watchedBoards: 100,
      evidenceRetentionDays: null,
      supplyWatch: true,
      handoffLinks: true,
    });
  });

  it("enforces board entitlement boundary transitions", () => {
    // Free tier: allowed 0 -> 1, blocked at 1
    expect(canWatchAnotherBoard("free", 0)).toEqual({ allowed: true });
    const freeBlocked = canWatchAnotherBoard("free", 1);
    expect(freeBlocked.allowed).toBe(false);
    if (!freeBlocked.allowed) {
      expect(freeBlocked.requiredTier).toBe("team");
    }

    // Team tier: allowed up to 9, blocked at 10
    expect(canWatchAnotherBoard("team", 9)).toEqual({ allowed: true });
    const teamBlocked = canWatchAnotherBoard("team", 10);
    expect(teamBlocked.allowed).toBe(false);
    if (!teamBlocked.allowed) {
      expect(teamBlocked.requiredTier).toBe("business");
    }

    // Business tier: allowed up to 99, blocked at 100
    expect(canWatchAnotherBoard("business", 99)).toEqual({ allowed: true });
    const businessBlocked = canWatchAnotherBoard("business", 100);
    expect(businessBlocked.allowed).toBe(false);
    if (!businessBlocked.allowed) {
      expect(businessBlocked.requiredTier).toBeUndefined();
    }
  });

  it("validates feature gates by plan tier", () => {
    expect(supplyWatchEnabled("free")).toBe(false);
    expect(supplyWatchEnabled("team")).toBe(true);
    expect(supplyWatchEnabled("business")).toBe(true);

    expect(handoffLinksEnabled("free")).toBe(false);
    expect(handoffLinksEnabled("team")).toBe(true);
    expect(handoffLinksEnabled("business")).toBe(true);
  });
});

describe("Stripe Event & Price Mapping", () => {
  it("includes all necessary webhook event types in handledStripeEventTypes", () => {
    expect(handledStripeEventTypes.has("checkout.session.completed")).toBe(true);
    expect(handledStripeEventTypes.has("customer.subscription.created")).toBe(true);
    expect(handledStripeEventTypes.has("customer.subscription.updated")).toBe(true);
    expect(handledStripeEventTypes.has("customer.subscription.deleted")).toBe(true);
    expect(handledStripeEventTypes.has("invoice.paid")).toBe(true);
    expect(handledStripeEventTypes.has("invoice.payment_failed")).toBe(true);
    expect(handledStripeEventTypes.has("unknown.event.type")).toBe(false);
  });

  it("resolves tier and interval correctly from configured price IDs", () => {
    const config = {
      teamMonthlyPriceId: "price_team_m",
      teamYearlyPriceId: "price_team_y",
      businessMonthlyPriceId: "price_biz_m",
      businessYearlyPriceId: "price_biz_y",
    };

    expect(resolveTierFromPriceId("price_team_m", config)).toBe("team");
    expect(resolveTierFromPriceId("price_team_y", config)).toBe("team");
    expect(resolveTierFromPriceId("price_biz_m", config)).toBe("business");
    expect(resolveTierFromPriceId("price_biz_y", config)).toBe("business");
    expect(resolveTierFromPriceId("price_unknown", config)).toBeNull();

    expect(resolveIntervalFromPriceId("price_team_m", config)).toBe("month");
    expect(resolveIntervalFromPriceId("price_team_y", config)).toBe("year");
    expect(resolveIntervalFromPriceId("price_biz_m", config)).toBe("month");
    expect(resolveIntervalFromPriceId("price_biz_y", config)).toBe("year");
    expect(resolveIntervalFromPriceId("price_unknown", config)).toBeNull();
  });
});

describe("Billing Contract Schema Validation", () => {
  it("validates valid customer and subscription objects", () => {
    const customer = {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: "acme-corp",
      stripeCustomerId: "cus_123",
      tier: "team",
      status: "active",
      trialEndsAt: null,
      graceEndsAt: null,
      currentPeriodEnd: "2026-12-31T23:59:59.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(billingCustomerSchema.safeParse(customer).success).toBe(true);

    const subscription = {
      id: "22222222-2222-4222-8222-222222222222",
      tenantId: "acme-corp",
      stripeSubscriptionId: "sub_123",
      stripePriceId: "price_team_m",
      tier: "team",
      interval: "month",
      status: "active",
      quantity: 5,
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(billingSubscriptionSchema.safeParse(subscription).success).toBe(true);
  });
});
