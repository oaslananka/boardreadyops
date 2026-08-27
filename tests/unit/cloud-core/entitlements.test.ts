import { describe, expect, it } from "vitest";
import {
  canWatchAnotherBoard,
  evidenceVisibleFrom,
  handoffLinksEnabled,
  planLimits,
  planTierOf,
  supplyWatchEnabled,
} from "../../../packages/cloud-core/src/entitlements.js";

describe("plan entitlements", () => {
  it("resolves the stored tier regardless of casing or padding", () => {
    expect(planTierOf(" Team ")).toBe("team");
    expect(planTierOf("BUSINESS")).toBe("business");
  });

  it("degrades an unknown or missing tier to the least privileged one", () => {
    // A row written by a newer deployment must not take the control plane down. This also
    // covers the retired 'pro' value and a stale pre-migration 'team' meaning: neither name
    // is recognised on its own, so an unmigrated row fails safe rather than being silently
    // reinterpreted as the new, lower-privileged 'team' tier.
    expect(planTierOf("pro")).toBe("free");
    expect(planTierOf("enterprise-unreleased")).toBe("free");
    expect(planTierOf(undefined)).toBe("free");
    expect(planTierOf(null)).toBe("free");
    expect(planTierOf("")).toBe("free");
  });

  it("allows a board while the tier has room", () => {
    expect(canWatchAnotherBoard("team", 3)).toEqual({ allowed: true });
  });

  it("refuses the board that would exceed the tier and names the tier that fits", () => {
    const decision = canWatchAnotherBoard("free", 1);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.limit).toBe(1);
    expect(decision.current).toBe(1);
    expect(decision.requiredTier).toBe("team");
    expect(decision.reason).toContain("Upgrade to team");
  });

  it("says so plainly when no published plan is large enough", () => {
    const decision = canWatchAnotherBoard("business", 100);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.requiredTier).toBeUndefined();
    expect(decision.reason).toContain("Contact us");
  });

  it("gates supply watch and handoff links to paid tiers", () => {
    expect(supplyWatchEnabled("free")).toBe(false);
    expect(supplyWatchEnabled("team")).toBe(true);
    expect(handoffLinksEnabled("free")).toBe(false);
    expect(handoffLinksEnabled("business")).toBe(true);
  });

  it("bounds evidence visibility per tier and keeps business unbounded", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");

    expect(evidenceVisibleFrom("free", now)?.toISOString()).toBe("2026-07-25T00:00:00.000Z");
    expect(evidenceVisibleFrom("team", now)?.toISOString()).toBe("2025-08-24T00:00:00.000Z");
    expect(evidenceVisibleFrom("business", now)).toBeUndefined();
  });

  it("keeps every tier's board allowance at least as large as the one below", () => {
    expect(planLimits("team").watchedBoards).toBeGreaterThan(planLimits("free").watchedBoards);
    expect(planLimits("business").watchedBoards).toBeGreaterThan(planLimits("team").watchedBoards);
  });

  it("gives the new business tier at least the entitlements the old top tier ('team') had", () => {
    // The pre-migration 'team' tier watched 100 boards with unlimited retention, supply
    // watch, and handoff links. Migration 0047 moves those installations to 'business', so
    // 'business' must never fall below what 'team' used to guarantee.
    const business = planLimits("business");
    expect(business.watchedBoards).toBeGreaterThanOrEqual(100);
    expect(business.evidenceRetentionDays).toBeNull();
    expect(business.supplyWatch).toBe(true);
    expect(business.handoffLinks).toBe(true);
  });
});
