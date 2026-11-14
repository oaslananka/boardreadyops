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
const originalEnvironment = new Map([...stripeEnvironment, "BILLING_MODE"].map((name) => [name, process.env[name]]));

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

  process.env.BILLING_MODE = "marketplace_free";
  process.env.STRIPE_SECRET_KEY = "sk_test_not_real";
  process.env.STRIPE_TEAM_MONTHLY_PRICE_ID = "price_team_month";
  process.env.STRIPE_TEAM_YEARLY_PRICE_ID = "price_team_year";
  process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID = "price_business_month";
  process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID = "price_business_year";
});

afterEach(() => {
  viewerAuthorization.mockReset();
  for (const name of [...stripeEnvironment, "BILLING_MODE"]) {
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

  it("rejects both checkout and customer portal without external redirects during free beta", async () => {
    process.env.BILLING_MODE = "beta_free";
    for (const [path, body] of [
      ["/api/v1/billing/checkout", { tier: "team", interval: "month" }],
      ["/api/v1/billing/portal", {}],
    ] as const) {
      const req = new Request(`https://boardreadyops.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = path.includes("checkout") ? await checkoutPost(req) : await portalPost(req);
      expect(result.status).toBe(410);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(await result.json()).toMatchObject({
        ok: false,
        error: "Paid upgrades and checkout are unavailable during the free beta",
        code: "free_beta_only",
      });
    }
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
