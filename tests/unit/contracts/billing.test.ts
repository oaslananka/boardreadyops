import { isActiveContributorActivity } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";

describe("isActiveContributorActivity", () => {
  it("counts a paid-seat action from an internal member", () => {
    expect(isActiveContributorActivity("policy_update", "internal")).toBe(true);
    expect(isActiveContributorActivity("disposition", "internal")).toBe(true);
    expect(isActiveContributorActivity("release_create", "internal")).toBe(true);
    expect(isActiveContributorActivity("workspace_manage", "internal")).toBe(true);
  });

  it("never counts a guest/external actor, even for a billable action, per spec", () => {
    expect(isActiveContributorActivity("policy_update", "guest")).toBe(false);
    expect(isActiveContributorActivity("disposition", "external")).toBe(false);
  });

  it("does not count a read-only action from an internal member", () => {
    expect(isActiveContributorActivity("view_review", "internal")).toBe(false);
    expect(isActiveContributorActivity("comment", "internal")).toBe(false);
  });
});
