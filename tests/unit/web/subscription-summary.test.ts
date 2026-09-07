import { describe, expect, it } from "vitest";
import { normalizePlanTier, summarizeSubscription } from "../../../apps/web/lib/subscription-summary.js";
import type { ViewerInstallation } from "../../../apps/web/lib/viewer-installations.js";

function installation(accountLogin: string, planTier: string): ViewerInstallation {
  return {
    id: `inst_${accountLogin}`,
    githubInstallationId: 1,
    accountLogin,
    planTier,
    hasComponentCredential: false,
    componentCredentialRejectedAt: undefined,
    componentCredentialRejectedReason: undefined,
  };
}

describe("normalizePlanTier", () => {
  it("maps the stored tiers onto the ones the UI knows", () => {
    expect(normalizePlanTier("team")).toBe("team");
    expect(normalizePlanTier("BUSINESS")).toBe("business");
    expect(normalizePlanTier(" pilot ")).toBe("pilot");
  });

  it("reads anything unrecognised as community rather than granting entitlement", () => {
    // Showing less than someone has is an annoyance; showing more is a billing dispute.
    expect(normalizePlanTier("free")).toBe("community");
    expect(normalizePlanTier("enterprise-legacy")).toBe("community");
    expect(normalizePlanTier(undefined)).toBe("community");
  });
});

describe("summarizeSubscription", () => {
  it("defaults to community when the viewer has no installations", () => {
    expect(summarizeSubscription([])).toEqual({ tier: "community", accountLogin: undefined, mixed: false });
  });

  it("takes the highest tier and names the account it came from", () => {
    const summary = summarizeSubscription([installation("acme", "free"), installation("initech", "business")]);
    expect(summary).toEqual({ tier: "business", accountLogin: "initech", mixed: true });
  });

  it("does not report a mix when every installation agrees", () => {
    const summary = summarizeSubscription([installation("acme", "team"), installation("initech", "team")]);
    expect(summary).toMatchObject({ tier: "team", mixed: false });
  });

  it("ranks pilot above business", () => {
    expect(summarizeSubscription([installation("a", "business"), installation("b", "pilot")]).tier).toBe("pilot");
  });
});
