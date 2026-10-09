import { describe, expect, it } from "vitest";
import { bomRiskSummaryFromFindings } from "../../../src/core/bom-risk.js";

describe("BOM risk summary reconstruction", () => {
  it("ignores unrelated findings and risk-score findings without details", () => {
    expect(bomRiskSummaryFromFindings([])).toBeUndefined();
    expect(
      bomRiskSummaryFromFindings([
        { ruleId: "bom.missing-mpn", details: { reference: "R1" } },
        { ruleId: "bom.risk-score" },
        { ruleId: "bom.risk-score", details: undefined },
      ]),
    ).toBeUndefined();
  });

  it("uses the first risk finding for aggregate metadata and counts every valid level", () => {
    const factors = {
      missingMpn: false,
      missingManufacturer: false,
      noSuppliers: false,
      singleSourceNoAlternates: false,
    };
    const summary = bomRiskSummaryFromFindings([
      { ruleId: "bom.missing-mpn", details: { reference: "noise", riskLevel: "critical" } },
      {
        ruleId: "bom.risk-score",
        details: {
          reference: "C1",
          mpn: "CAP-1",
          manufacturer: "Mfr A",
          riskScore: 91,
          riskLevel: "critical",
          factors,
          totalComponents: 8,
          overallBomRiskScore: 42,
        },
      },
      {
        ruleId: "bom.risk-score",
        details: { reference: "R2", riskScore: 51, riskLevel: "high", factors },
      },
      {
        ruleId: "bom.risk-score",
        details: { reference: "U3", riskScore: 29, riskLevel: "medium", factors },
      },
      {
        ruleId: "bom.risk-score",
        details: { reference: "L4", riskScore: 7, riskLevel: "low", factors },
      },
      {
        ruleId: "bom.risk-score",
        details: { reference: "D5", riskScore: 0, riskLevel: "none", factors },
      },
    ]);

    expect(summary).toEqual({
      totalComponents: 8,
      overallRiskScore: 42,
      overallRiskLevel: "high",
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      lowCount: 1,
      components: [
        { reference: "C1", mpn: "CAP-1", manufacturer: "Mfr A", riskScore: 91, riskLevel: "critical", factors },
        { reference: "R2", mpn: undefined, manufacturer: undefined, riskScore: 51, riskLevel: "high", factors },
        { reference: "U3", mpn: undefined, manufacturer: undefined, riskScore: 29, riskLevel: "medium", factors },
        { reference: "L4", mpn: undefined, manufacturer: undefined, riskScore: 7, riskLevel: "low", factors },
        { reference: "D5", mpn: undefined, manufacturer: undefined, riskScore: 0, riskLevel: "none", factors },
      ],
    });
  });

  it("rejects malformed component detail types instead of echoing them", () => {
    const summary = bomRiskSummaryFromFindings([
      {
        ruleId: "bom.risk-score",
        details: {
          reference: 14,
          mpn: 99,
          manufacturer: ["incorrect"],
          riskScore: "90",
          riskLevel: "INVALID",
          totalComponents: "9",
          overallBomRiskScore: "80",
        },
      },
      {
        ruleId: "bom.risk-score",
        details: {
          reference: "R2",
          mpn: "MPN-2",
          manufacturer: "Maker",
          riskScore: 12,
          riskLevel: 55,
        },
      },
    ]);
    expect(summary).toMatchObject({
      totalComponents: 2,
      overallRiskScore: 0,
      overallRiskLevel: "none",
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      components: [
        { reference: "", mpn: undefined, manufacturer: undefined, riskScore: 0, riskLevel: "none", factors: {} },
        { reference: "R2", mpn: "MPN-2", manufacturer: "Maker", riskScore: 12, riskLevel: "none", factors: {} },
      ],
    });
  });

  it("does not treat a known risk level on an unrelated finding as a BOM component", () => {
    const summary = bomRiskSummaryFromFindings([
      { ruleId: "bom.risk-score", details: { reference: "U1", riskLevel: "low", overallBomRiskScore: 20 } },
      { ruleId: "bom.lifecycle", details: { reference: "U2", riskLevel: "critical" } },
      { ruleId: "bom.risk-score" },
    ]);
    expect(summary).toMatchObject({
      totalComponents: 1,
      overallRiskScore: 20,
      overallRiskLevel: "medium",
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 1,
      components: [{ reference: "U1", riskLevel: "low" }],
    });
  });
});
