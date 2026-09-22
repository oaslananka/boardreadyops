import { describe, expect, it } from "vitest";
import { createFinding, shouldFail } from "../../../src/core/findings.js";
import { clearRulesForTests, type Rule, registerRule } from "../../../src/core/rule-registry.js";

describe("evidence strength gating", () => {
  it("does not block on high-severity heuristic finding by default, but blocks on exact medium finding", () => {
    clearRulesForTests();

    const heuristicRule: Rule = {
      meta: {
        id: "bom.risk-score",
        title: "BOM Risk Score",
        description: "Heuristic risk score",
        rationale: "Risk scoring",
        defaultSeverity: "high",
        appliesTo: ["bom"],
        tags: ["sourcing"],
        category: "sourcing",
        evidenceType: "heuristic",
        fixability: "none",
        vendorDependence: "none",
        configKeys: [],
        kicadVersions: ["9", "10"],
      },
      run: async () => [],
    };

    const exactRule: Rule = {
      meta: {
        id: "bom.mpn-present",
        title: "MPN Present",
        description: "Exact MPN check",
        rationale: "Sourcing trace",
        defaultSeverity: "medium",
        appliesTo: ["bom"],
        tags: ["sourcing"],
        category: "sourcing",
        evidenceType: "exact",
        fixability: "manual",
        vendorDependence: "none",
        configKeys: [],
        kicadVersions: ["9", "10"],
      },
      run: async () => [],
    };

    registerRule(heuristicRule);
    registerRule(exactRule);

    const heuristicFinding = createFinding({
      ruleId: "bom.risk-score",
      severity: "high",
      message: "High risk score detected",
      resource: { path: "bom.csv", kind: "bom" },
    });

    const exactFinding = createFinding({
      ruleId: "bom.mpn-present",
      severity: "medium",
      message: "Missing MPN",
      resource: { path: "bom.csv", kind: "bom" },
    });

    // Default policy (allowHeuristicBlock = false): high heuristic finding does NOT block when failOn="medium"
    expect(shouldFail([heuristicFinding], "medium")).toBe(false);

    // Exact medium finding DOES block when failOn="medium"
    expect(shouldFail([exactFinding], "medium")).toBe(true);

    // Explicit policy override (allowHeuristicBlock = true): heuristic finding DOES block
    expect(shouldFail([heuristicFinding], "medium", { allowHeuristicBlock: true })).toBe(true);
  });
});
