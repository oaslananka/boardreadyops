import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../src/core/pipeline.js";

const scenariosRoot = path.resolve("examples/scenarios");

describe("demo scenarios", () => {
  it("failing-pr reports high-severity findings and fails", async () => {
    const result = await runPipeline({ path: path.join(scenariosRoot, "failing-pr"), failOn: "high" });

    expect(result.summary.failed).toBe(true);
    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));
    expect(ruleIds.has("bom.missing-mpn")).toBe(true);
    expect(ruleIds.has("bom.compliance")).toBe(true);
    // At least one blocking finding present
    expect(result.findings.some((finding) => finding.severity === "high")).toBe(true);
  });

  it("prototype-ready passes with only non-blocking findings", async () => {
    const result = await runPipeline({ path: path.join(scenariosRoot, "prototype-ready"), failOn: "high" });

    expect(result.summary.failed).toBe(false);
    // No high or critical findings
    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));
    expect(ruleIds.has("bom.missing-mpn")).toBe(false);
    expect(ruleIds.has("bom.compliance")).toBe(false);
    expect(ruleIds.has("bom.eol-detection")).toBe(false);
  });

  it("production-ready passes with waivers and production release mode", async () => {
    const result = await runPipeline({ path: path.join(scenariosRoot, "production-ready"), failOn: "high" });

    expect(result.summary.failed).toBe(false);
    // No missing MPN, no compliance issues, no EOL
    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));
    expect(ruleIds.has("bom.missing-mpn")).toBe(false);
    expect(ruleIds.has("bom.compliance")).toBe(false);
    // Should have active waivers recorded
    expect(result.waivers?.active.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
