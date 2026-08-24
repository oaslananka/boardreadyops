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
    expect(planTierOf(" Pro ")).toBe("pro");
    expect(planTierOf("TEAM")).toBe("team");
  });

  it("degrades an unknown or missing tier to the least privileged one", () => {
    // A row written by a newer deployment must not take the control plane down.
    expect(planTierOf("enterprise-unreleased")).toBe("free");
    expect(planTierOf(undefined)).toBe("free");
    expect(planTierOf(null)).toBe("free");
    expect(planTierOf("")).toBe("free");
  });

  it("allows a board while the tier has room", () => {
    expect(canWatchAnotherBoard("pro", 3)).toEqual({ allowed: true });
  });

  it("refuses the board that would exceed the tier and names the tier that fits", () => {
    const decision = canWatchAnotherBoard("free", 1);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.limit).toBe(1);
    expect(decision.current).toBe(1);
    expect(decision.requiredTier).toBe("pro");
    expect(decision.reason).toContain("Upgrade to pro");
  });

  it("says so plainly when no published plan is large enough", () => {
    const decision = canWatchAnotherBoard("team", 100);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.requiredTier).toBeUndefined();
    expect(decision.reason).toContain("Contact us");
  });

  it("gates supply watch and handoff links to paid tiers", () => {
    expect(supplyWatchEnabled("free")).toBe(false);
    expect(supplyWatchEnabled("pro")).toBe(true);
    expect(handoffLinksEnabled("free")).toBe(false);
    expect(handoffLinksEnabled("team")).toBe(true);
  });

  it("bounds evidence visibility per tier and keeps team unbounded", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");

    expect(evidenceVisibleFrom("free", now)?.toISOString()).toBe("2026-07-25T00:00:00.000Z");
    expect(evidenceVisibleFrom("pro", now)?.toISOString()).toBe("2025-08-24T00:00:00.000Z");
    expect(evidenceVisibleFrom("team", now)).toBeUndefined();
  });

  it("keeps every tier's board allowance at least as large as the one below", () => {
    expect(planLimits("pro").watchedBoards).toBeGreaterThan(planLimits("free").watchedBoards);
    expect(planLimits("team").watchedBoards).toBeGreaterThan(planLimits("pro").watchedBoards);
  });
});
