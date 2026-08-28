import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization,
}));

import { POST as checkoutPost } from "../../../apps/web/app/api/v1/billing/checkout/route.js";
import { POST as portalPost } from "../../../apps/web/app/api/v1/billing/portal/route.js";

const stripeEnvironment = [
  "STRIPE_SECRET_KEY",
  "STRIPE_TEAM_MONTHLY_PRICE_ID",
  "STRIPE_TEAM_YEARLY_PRICE_ID",
  "STRIPE_BUSINESS_MONTHLY_PRICE_ID",
  "STRIPE_BUSINESS_YEARLY_PRICE_ID",
] as const;
const originalEnvironment = new Map(stripeEnvironment.map((name) => [name, process.env[name]]));

beforeEach(() => {
  viewerAuthorization.mockResolvedValue({
    session: {
      userId: 1,
      login: "octo-org",
      installationIds: [12345],
      issuedAt: "2026-08-28T00:00:00.000Z",
      expiresAt: "2026-08-29T00:00:00.000Z",
    },
    authorizeRepository: vi.fn().mockResolvedValue(true),
    authorizeInstallation: vi.fn().mockResolvedValue(true),
  });

  process.env.STRIPE_SECRET_KEY = "sk_test_not_real";
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
});

afterEach(() => {
  viewerAuthorization.mockReset();
  for (const name of stripeEnvironment) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("free-only Marketplace billing routes", () => {
  it("refuses external Stripe checkout while the published Marketplace plan is Community Free", async () => {
    const response = await checkoutPost(
      new Request("https://boardreadyops.test/api/v1/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: "team", interval: "month" }),
      }),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "External paid billing is unavailable while the GitHub Marketplace listing is Community Free",
      code: "marketplace_free_only",
    });
  });

  it("refuses the external Stripe customer portal while the published Marketplace plan is Community Free", async () => {
    const response = await portalPost(
      new Request("https://boardreadyops.test/api/v1/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "External paid billing is unavailable while the GitHub Marketplace listing is Community Free",
      code: "marketplace_free_only",
    });
  });

  it("preserves authentication requirements on the retired paid billing routes", async () => {
    const signedOut = {
      session: undefined,
      authorizeRepository: vi.fn().mockResolvedValue(false),
      authorizeInstallation: vi.fn().mockResolvedValue(false),
    };

    viewerAuthorization.mockResolvedValueOnce(signedOut);
    const checkout = await checkoutPost(
      new Request("https://boardreadyops.test/api/v1/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: "team", interval: "month" }),
      }),
    );

    viewerAuthorization.mockResolvedValueOnce(signedOut);
    const portal = await portalPost(
      new Request("https://boardreadyops.test/api/v1/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(checkout.status).toBe(401);
    expect(portal.status).toBe(401);
  });
});
