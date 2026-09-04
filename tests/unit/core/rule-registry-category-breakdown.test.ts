import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/findings.js";
import { categorizeFindings, clearRulesForTests, registerRule } from "../../../src/core/rule-registry.js";

function fakeRule(id: string, category: "electrical" | "sourcing" | "assembly") {
  return {
    meta: {
      id,
      title: id,
      description: id,
      rationale: id,
      defaultSeverity: "medium" as const,
      appliesTo: [],
      configKeys: [],
      kicadVersions: ["10" as const],
      tags: [],
      category,
      evidenceType: "exact" as const,
      fixability: "manual" as const,
      vendorDependence: "none" as const,
    },
    async run() {
      return [];
    },
  };
}

function finding(ruleId: string, severity: Finding["severity"]): Finding {
  return {
    ruleId,
    severity,
    message: `${ruleId} finding`,
    resource: { path: "board.kicad_pcb", kind: "pcb" },
    fingerprint: `${ruleId}-${severity}`,
  };
}

describe("categorizeFindings", () => {
  beforeEach(() => {
    clearRulesForTests();
    registerRule(fakeRule("drc.clearance", "electrical"));
    registerRule(fakeRule("bom.missing-mpn", "sourcing"));
  });

  afterEach(() => {
    clearRulesForTests();
  });

  it("buckets findings by their rule's registered category and counts severities", () => {
    const breakdown = categorizeFindings([
      finding("drc.clearance", "critical"),
      finding("drc.clearance", "high"),
      finding("bom.missing-mpn", "medium"),
    ]);

    const electrical = breakdown.find((b) => b.category === "electrical");
    const sourcing = breakdown.find((b) => b.category === "sourcing");
    expect(electrical).toMatchObject({ total: 2, critical: 1, high: 1 });
    expect(sourcing).toMatchObject({ total: 1, medium: 1 });
  });

  it("includes every known category at zero when no findings belong to it", () => {
    const breakdown = categorizeFindings([finding("drc.clearance", "high")]);

    const assembly = breakdown.find((b) => b.category === "assembly");
    expect(assembly).toMatchObject({ total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });

  it("falls back to unclassified for a finding whose rule id is not registered", () => {
    const breakdown = categorizeFindings([finding("plugin.unknown-rule", "low")]);

    const unclassified = breakdown.find((b) => b.category === "unclassified");
    expect(unclassified).toMatchObject({ total: 1, low: 1 });
  });

  it("omits unclassified entirely when every finding maps to a known category", () => {
    const breakdown = categorizeFindings([finding("drc.clearance", "high")]);

    expect(breakdown.some((b) => b.category === "unclassified")).toBe(false);
  });

  it("returns zeroed buckets for every known category with no findings at all", () => {
    const breakdown = categorizeFindings([]);

    expect(breakdown).toHaveLength(6);
    expect(breakdown.every((b) => b.total === 0)).toBe(true);
  });
});
