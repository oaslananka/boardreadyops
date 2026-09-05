import type { IngestionCapabilities } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";
import { checkRuleCapabilities, type Rule } from "../../../src/core/rule-registry.js";

function makeFakeRule(opts: {
  id: string;
  requiresNetlist?: boolean;
  requiredCapabilities?: (keyof IngestionCapabilities)[];
}): Rule {
  return {
    meta: {
      id: opts.id,
      title: opts.id,
      description: opts.id,
      rationale: opts.id,
      defaultSeverity: "high",
      appliesTo: ["pcb"],
      configKeys: [],
      kicadVersions: ["10"],
      tags: ["test"],
      category: "electrical",
      evidenceType: "exact",
      fixability: "manual",
      vendorDependence: "none",
      requiresNetlist: opts.requiresNetlist,
      requiredCapabilities: opts.requiredCapabilities,
    },
    run: async () => [],
  };
}

const fullCapabilities: IngestionCapabilities = {
  hasGerberOutlines: true,
  hasPlatedHoles: true,
  hasNonPlatedHoles: true,
  hasBomMapping: true,
  hasCentroidPlacement: true,
  hasNetlistConnectivity: true,
  hasSchematicHierarchies: true,
};

describe("checkRuleCapabilities", () => {
  it("allows any rule when no capabilities are supplied", () => {
    const rule = makeFakeRule({ id: "drc.net-shorts", requiresNetlist: true });
    expect(checkRuleCapabilities(rule, undefined)).toEqual({ allowed: true });
  });

  it("allows a rule with no requirements once capabilities are known", () => {
    const rule = makeFakeRule({ id: "plain-rule" });
    expect(checkRuleCapabilities(rule, fullCapabilities)).toEqual({ allowed: true });
  });

  it("skips rules requiring netlist when package lacks netlist connectivity", () => {
    const rule = makeFakeRule({ id: "drc.net-shorts", requiresNetlist: true });
    const result = checkRuleCapabilities(rule, { ...fullCapabilities, hasNetlistConnectivity: false });
    expect(result).toEqual({
      allowed: false,
      reason: "Input package does not include electrical netlist connectivity.",
    });
  });

  it("checks specific requiredCapabilities (BOM, plated holes, outlines)", () => {
    const caps: IngestionCapabilities = {
      ...fullCapabilities,
      hasPlatedHoles: false,
    };

    expect(
      checkRuleCapabilities(makeFakeRule({ id: "component_lifecycle", requiredCapabilities: ["hasBomMapping"] }), caps),
    ).toEqual({
      allowed: true,
    });
    expect(
      checkRuleCapabilities(
        makeFakeRule({ id: "copper_clearance", requiredCapabilities: ["hasGerberOutlines"] }),
        caps,
      ),
    ).toEqual({
      allowed: true,
    });
    expect(
      checkRuleCapabilities(makeFakeRule({ id: "drill_completeness", requiredCapabilities: ["hasPlatedHoles"] }), caps),
    ).toEqual({
      allowed: false,
      reason: "Input package does not include plated hole drill data.",
    });
  });
});
