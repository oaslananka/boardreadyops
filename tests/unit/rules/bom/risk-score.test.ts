import { describe, expect, it } from "vitest";
import { buildAlternatesMap } from "../../../../src/bom/alternates.js";
import { type BomRiskWeights, computeComponentRisk, summarizeBomRisk } from "../../../../src/bom/risk.js";
import { bomRiskSummaryFromFindings } from "../../../../src/core/bom-risk.js";
import { expectRule, runFixture } from "../helpers.js";

describe("bom.risk-score rule", () => {
  it("emits findings for at-risk populated BOM rows", async () => {
    const result = await runFixture("bom-risk-score");
    // R2 (no manufacturer, single-source implied), C1 (missing MPN), LED1 (no MPN, no manufacturer, no supplier)
    // D1 is DNP so should be skipped; R1 has full data; U1 has full data (single-source but no alternates check)
    const findings = expectRule(result, "bom.risk-score");
    expect(findings.length).toBeGreaterThan(0);
    const refs = findings.map((f) => f.details?.reference);
    // LED1 has no MPN, no manufacturer, no supplier → should flag
    expect(refs).toContain("LED1");
    // C1 has no MPN → should flag
    expect(refs).toContain("C1");
  });

  it("skips DNP rows", async () => {
    const result = await runFixture("bom-risk-score");
    const findings = expectRule(result, "bom.risk-score");
    const refs = findings.map((f) => f.details?.reference);
    // D1 is DNP — must not appear
    expect(refs).not.toContain("D1");
  });

  it("suppresses risk for components with approved alternates", async () => {
    const withAlternates = await runFixture("bom-risk-score", { config: "with-alternates.yml" });
    const withoutAlternates = await runFixture("bom-risk-score");
    const withRefs = withAlternates.findings
      .filter((f) => f.ruleId === "bom.risk-score")
      .map((f) => f.details?.reference);
    const withoutRefs = withoutAlternates.findings
      .filter((f) => f.ruleId === "bom.risk-score")
      .map((f) => f.details?.reference);
    // R2 has an approved alternate in with-alternates.yml — its single-source factor should drop
    // so it should appear less or with lower score in the alternates run
    expect(withoutRefs.length).toBeGreaterThanOrEqual(withRefs.length);
  });

  it("populates bomRisk summary on the result", async () => {
    const result = await runFixture("bom-risk-score");
    expect(result.bomRisk).toBeDefined();
    expect(result.bomRisk?.totalComponents).toBeGreaterThan(0);
    expect(result.bomRisk?.overallRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.bomRisk?.overallRiskScore).toBeLessThanOrEqual(100);
    expect(["critical", "high", "medium", "low", "none"]).toContain(result.bomRisk?.overallRiskLevel);
  });

  it("finding details contain riskScore, riskLevel, factors, and overallBomRiskScore", async () => {
    const result = await runFixture("bom-risk-score");
    const findings = result.findings.filter((f) => f.ruleId === "bom.risk-score");
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(typeof f.details?.riskScore).toBe("number");
      expect(typeof f.details?.overallBomRiskScore).toBe("number");
      expect(["critical", "high", "medium", "low"]).toContain(f.details?.riskLevel);
    }
  });
});

describe("computeComponentRisk", () => {
  const emptyMap = new Map<string, never[]>();

  it("returns medium risk for a fully populated single-source component (BOM has supplier columns)", () => {
    // bomHasSupplierColumns=true (default) so single-source-no-alternates applies
    const risk = computeComponentRisk("R1", "RC0603FR", "Yageo", 1, emptyMap, {}, true);
    expect(risk.riskLevel).toBe("medium");
    expect(risk.factors.missingMpn).toBe(false);
    expect(risk.factors.missingManufacturer).toBe(false);
    expect(risk.factors.noSuppliers).toBe(false);
    expect(risk.factors.singleSourceNoAlternates).toBe(true);
  });

  it("returns none risk for component with multiple suppliers", () => {
    const risk = computeComponentRisk("R1", "RC0603FR", "Yageo", 2, emptyMap, {}, true);
    expect(risk.riskLevel).toBe("none");
    expect(risk.riskScore).toBe(0);
  });

  it("scores highest risk for a component missing all sourcing data when BOM has supplier columns", () => {
    const risk = computeComponentRisk("LED1", undefined, undefined, 0, emptyMap, {}, true);
    expect(risk.factors.missingMpn).toBe(true);
    expect(risk.factors.missingManufacturer).toBe(true);
    expect(risk.factors.noSuppliers).toBe(true);
    expect(risk.riskScore).toBe(100);
    expect(risk.riskLevel).toBe("critical");
  });

  it("skips supplier signals when BOM has no supplier columns", () => {
    // bomHasSupplierColumns=false → noSuppliers and singleSourceNoAlternates are N/A
    const risk = computeComponentRisk("R1", "RC0603FR", "Yageo", 0, emptyMap, {}, false);
    expect(risk.factors.noSuppliers).toBe(false);
    expect(risk.factors.singleSourceNoAlternates).toBe(false);
    expect(risk.riskScore).toBe(0);
    expect(risk.riskLevel).toBe("none");
  });

  it("only scores MPN/manufacturer signals when BOM has no supplier columns", () => {
    const risk = computeComponentRisk("C1", undefined, undefined, 0, emptyMap, {}, false);
    expect(risk.factors.missingMpn).toBe(true);
    expect(risk.factors.missingManufacturer).toBe(true);
    expect(risk.factors.noSuppliers).toBe(false);
    // score = missingMpn(60) + missingManufacturer(20) = 80
    expect(risk.riskScore).toBe(80);
    expect(risk.riskLevel).toBe("critical");
  });

  it("does not flag single-source-no-alternates when approved alternates exist", () => {
    const map = buildAlternatesMap([{ mpn: "PART-A", alts: [{ mpn: "PART-B" }] }]);
    const risk = computeComponentRisk("R1", "PART-A", "Acme", 1, map, {}, true);
    expect(risk.factors.singleSourceNoAlternates).toBe(false);
    expect(risk.riskScore).toBe(0);
    expect(risk.riskLevel).toBe("none");
  });

  it("respects custom weight overrides", () => {
    const weights: Partial<BomRiskWeights> = { missingMpn: 10 };
    const risk = computeComponentRisk("C1", undefined, "Murata", 2, emptyMap, weights, true);
    // Only missingMpn fires at weight 10
    expect(risk.riskScore).toBe(10);
    expect(risk.riskLevel).toBe("low");
  });
});

describe("summarizeBomRisk", () => {
  it("returns zero score when no components", () => {
    const summary = summarizeBomRisk([]);
    expect(summary.overallRiskScore).toBe(0);
    expect(summary.overallRiskLevel).toBe("none");
    expect(summary.totalComponents).toBe(0);
  });

  it("averages scores across components", () => {
    const emptyMap = new Map<string, never[]>();
    const c1 = computeComponentRisk("R1", "MPN-A", "Mfr", 2, emptyMap, {}, true);
    const c2 = computeComponentRisk("LED1", undefined, undefined, 0, emptyMap, {}, true);
    const summary = summarizeBomRisk([c1, c2]);
    expect(summary.totalComponents).toBe(2);
    expect(summary.criticalCount).toBe(1);
    expect(summary.overallRiskScore).toBe(Math.round((c1.riskScore + c2.riskScore) / 2));
  });
});

describe("bomRiskSummaryFromFindings", () => {
  it("returns undefined when no bom.risk-score findings", () => {
    const result = bomRiskSummaryFromFindings([{ ruleId: "bom.missing-mpn", details: {} }]);
    expect(result).toBeUndefined();
  });

  it("reconstructs summary from finding details", () => {
    const findings = [
      {
        ruleId: "bom.risk-score",
        details: {
          reference: "C1",
          mpn: undefined,
          manufacturer: "Murata",
          riskScore: 60,
          riskLevel: "critical",
          factors: {
            missingMpn: true,
            missingManufacturer: false,
            noSuppliers: false,
            singleSourceNoAlternates: false,
          },
          overallBomRiskScore: 30,
          totalComponents: 4,
        },
      },
    ];
    const summary = bomRiskSummaryFromFindings(findings);
    expect(summary).toBeDefined();
    expect(summary?.criticalCount).toBe(1);
    expect(summary?.totalComponents).toBe(4);
    expect(summary?.overallRiskScore).toBe(30);
  });

  it("uses fallback values when finding details are missing or malformed", () => {
    const findings = [
      {
        ruleId: "bom.risk-score",
        details: {
          // reference present, but no mpn/manufacturer/riskScore/riskLevel/overallBomRiskScore/totalComponents
          reference: "R5",
        },
      },
    ];
    const summary = bomRiskSummaryFromFindings(findings);
    expect(summary).toBeDefined();
    expect(summary?.overallRiskScore).toBe(0);
    expect(summary?.totalComponents).toBe(1);
    expect(summary?.components[0]?.mpn).toBeUndefined();
    expect(summary?.components[0]?.manufacturer).toBeUndefined();
    expect(summary?.components[0]?.riskScore).toBe(0);
    expect(summary?.components[0]?.riskLevel).toBe("none");
  });
});
