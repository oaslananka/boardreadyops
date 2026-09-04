import { describe, expect, it } from "vitest";
import { resolveBillingMode } from "../../../apps/web/lib/billing-mode.js";

describe("resolveBillingMode", () => {
  it("defaults to marketplace_free when BILLING_MODE is unset", () => {
    expect(resolveBillingMode({})).toBe("marketplace_free");
  });

  it("defaults to marketplace_free for an unrecognized value", () => {
    expect(resolveBillingMode({ BILLING_MODE: "enterprise-invoice" })).toBe("marketplace_free");
  });

  it("accepts stripe", () => {
    expect(resolveBillingMode({ BILLING_MODE: "stripe" })).toBe("stripe");
  });

  it("accepts both", () => {
    expect(resolveBillingMode({ BILLING_MODE: "both" })).toBe("both");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveBillingMode({ BILLING_MODE: "  STRIPE  " })).toBe("stripe");
  });
});
