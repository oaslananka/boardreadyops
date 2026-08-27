import { describe, expect, it } from "vitest";
import { DEMO_REVIEWS, getDemoReview } from "../../../apps/web/lib/demo-data.js";

describe("getDemoReview", () => {
  it("finds a review by its id", () => {
    const first = DEMO_REVIEWS[0];
    expect(first).toBeDefined();
    expect(getDemoReview(first?.id ?? "")).toBe(first);
  });

  it("finds a review by its pull request number as a string", () => {
    const first = DEMO_REVIEWS[0];
    expect(getDemoReview(String(first?.pullRequestNumber))).toBe(first);
  });

  it("returns undefined for an id that matches no fixture", () => {
    expect(getDemoReview("does-not-exist")).toBeUndefined();
  });
});
