import { describe, expect, it } from "vitest";
import { riskLevelFromScore } from "../../../src/util/risk-level.js";

describe("riskLevelFromScore", () => {
  it.each([
    [0, "none"],
    [1, "low"],
    [19, "low"],
    [20, "medium"],
    [39, "medium"],
    [40, "high"],
    [59, "high"],
    [60, "critical"],
    [100, "critical"],
  ])("returns %s for score %d", (score, level) => {
    expect(riskLevelFromScore(score)).toBe(level);
  });
});