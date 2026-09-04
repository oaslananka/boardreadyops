import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../src/core/pipeline.js";

const fixtureRoot = path.resolve("tests/fixtures/projects/safe-basic");

describe("runPipeline categoryBreakdown", () => {
  it("attaches a per-domain finding breakdown to the run result", async () => {
    const result = await runPipeline({
      cwd: fixtureRoot,
      path: fixtureRoot,
      rules: [],
      skips: [],
      executionPolicy: "safe",
      failOn: "never",
    });

    expect(result.categoryBreakdown).toBeDefined();
    expect(result.categoryBreakdown?.length).toBeGreaterThanOrEqual(6);
    const totalAcrossCategories = result.categoryBreakdown?.reduce((sum, c) => sum + c.total, 0) ?? 0;
    expect(totalAcrossCategories).toBe(result.findings.length);
  });
});
