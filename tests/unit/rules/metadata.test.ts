import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RuleCategory,
  RuleEvidenceType,
  RuleFixability,
  RuleVendorDependence,
} from "../../../src/core/rule-registry.js";
import { clearRulesForTests, listRules } from "../../../src/core/rule-registry.js";
import { registerBuiltInRules, resetBuiltInRuleRegistrationForTests } from "../../../src/rules/_index.js";

const supportedKiCadVersions = new Set(["9", "10", "future"]);
const validCategories = new Set<RuleCategory>([
  "electrical",
  "manufacturability",
  "assembly",
  "testability",
  "sourcing",
  "release",
  "unclassified",
]);
const validEvidenceTypes = new Set<RuleEvidenceType>(["exact", "heuristic", "unclassified"]);
const validFixability = new Set<RuleFixability>(["manual", "assisted", "none", "unclassified"]);
const validVendorDependence = new Set<RuleVendorDependence>([
  "manufacturer-specific",
  "profile-specific",
  "none",
  "unclassified",
]);

interface ExpectedClassification {
  category: RuleCategory;
  evidenceType: RuleEvidenceType;
  fixability: RuleFixability;
  vendorDependence: RuleVendorDependence;
}

/**
 * Real, per-rule DFM/DFA/DFT classification for every built-in rule (W05 ledger item).
 * See the doc comments on RuleCategory/RuleEvidenceType/RuleFixability/RuleVendorDependence
 * in src/core/rule-registry.ts for how each axis is defined.
 */
const expectedClassification: Record<string, ExpectedClassification> = {
  "bom.compliance": {
    category: "sourcing",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  "bom.dnp-consistency": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "bom.eol-detection": {
    category: "sourcing",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  "bom.footprint-mismatch": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "bom.identity-conflicts": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "bom.lifecycle": { category: "sourcing", evidenceType: "heuristic", fixability: "manual", vendorDependence: "none" },
  "bom.missing-mpn": { category: "sourcing", evidenceType: "exact", fixability: "manual", vendorDependence: "none" },
  "bom.risk-score": { category: "sourcing", evidenceType: "heuristic", fixability: "none", vendorDependence: "none" },
  "bom.single-source": { category: "sourcing", evidenceType: "exact", fixability: "manual", vendorDependence: "none" },
  "bom.unknown-lifecycle": {
    category: "sourcing",
    evidenceType: "exact",
    fixability: "none",
    vendorDependence: "none",
  },
  "bom.variant-consistency": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "design.board-outline": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "design.copper-balance": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "design.unique-references": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "drc.kicad": { category: "electrical", evidenceType: "exact", fixability: "assisted", vendorDependence: "none" },
  "erc.kicad": { category: "electrical", evidenceType: "exact", fixability: "assisted", vendorDependence: "none" },
  "firmware.arduino-pin-contract": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "firmware.esp-idf-pin-contract": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "firmware.platformio-pin-contract": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "firmware.stm32cubemx-pin-contract": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "firmware.zephyr-pin-contract": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.assembly-sides": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.drill-coverage": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.fab-notes": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.fiducials": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.jobset-outputs": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.layer-stackup": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.outputs-present": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "manufacturer-specific",
  },
  "manufacturing.package-completeness": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.panel-sanity": {
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.dfm-pin1-markers": {
    category: "manufacturability",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.dfm-polarity-markers": {
    category: "manufacturability",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  "manufacturing.position-coverage": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.dfm-silkscreen-over-pad": {
    category: "manufacturability",
    evidenceType: "heuristic",
    fixability: "none",
    vendorDependence: "none",
  },
  "manufacturing.test-points": {
    category: "testability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "manufacturing.tooling-holes": {
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  "pinmap.verify": { category: "electrical", evidenceType: "exact", fixability: "manual", vendorDependence: "none" },
  "pinmap.collision": { category: "electrical", evidenceType: "exact", fixability: "manual", vendorDependence: "none" },
  "pinmap.unmapped-pin": {
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "pinmap.net-label": { category: "electrical", evidenceType: "exact", fixability: "manual", vendorDependence: "none" },
  "release.changelog-present": {
    category: "release",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "release.revision-set": {
    category: "release",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "release.tag-matches-revision": {
    category: "release",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  "release.version-format": {
    category: "release",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
};

describe("built-in rule metadata", () => {
  beforeEach(resetRuleRegistry);
  afterEach(resetRuleRegistry);

  it("keeps every registered rule complete for docs and automation", () => {
    registerBuiltInRules();

    const rules = listRules();
    expect(rules.length).toBeGreaterThan(0);

    for (const { meta } of rules) {
      expect(meta.description, `${meta.id} description`).toEqual(expect.any(String));
      expect(meta.description.trim(), `${meta.id} description`).not.toBe("");
      expect(meta.rationale, `${meta.id} rationale`).toEqual(expect.any(String));
      expect(meta.rationale.trim(), `${meta.id} rationale`).not.toBe("");
      expect(meta.appliesTo.length, `${meta.id} appliesTo`).toBeGreaterThan(0);
      expect(meta.configKeys.length, `${meta.id} configKeys`).toBeGreaterThan(0);

      expect(meta.kicadVersions, `${meta.id} kicadVersions`).toEqual(expect.any(Array));
      expect(meta.kicadVersions.length, `${meta.id} kicadVersions`).toBeGreaterThan(0);
      expect(
        meta.kicadVersions.every((version) => supportedKiCadVersions.has(version)),
        `${meta.id} kicadVersions`,
      ).toBe(true);

      expect(meta.tags, `${meta.id} tags`).toEqual(expect.any(Array));
      expect(meta.tags.length, `${meta.id} tags`).toBeGreaterThan(0);
      expect(
        meta.tags.every((tag) => tag.trim().length > 0),
        `${meta.id} tags`,
      ).toBe(true);

      expect(validCategories.has(meta.category), `${meta.id} category`).toBe(true);
      expect(validEvidenceTypes.has(meta.evidenceType), `${meta.id} evidenceType`).toBe(true);
      expect(validFixability.has(meta.fixability), `${meta.id} fixability`).toBe(true);
      expect(validVendorDependence.has(meta.vendorDependence), `${meta.id} vendorDependence`).toBe(true);

      // Built-in rules are never "unclassified" -- that value exists only for rules loaded
      // from a plugin whose PluginRuleMetadata contract does not carry this data.
      expect(meta.category, `${meta.id} category`).not.toBe("unclassified");
      expect(meta.evidenceType, `${meta.id} evidenceType`).not.toBe("unclassified");
      expect(meta.fixability, `${meta.id} fixability`).not.toBe("unclassified");
      expect(meta.vendorDependence, `${meta.id} vendorDependence`).not.toBe("unclassified");
    }
  });

  it("classifies every built-in rule's DFM/DFA/DFT category, evidence type, fixability, and vendor dependence", () => {
    registerBuiltInRules();

    const rules = listRules();
    const ruleIds = new Set(rules.map((rule) => rule.meta.id));

    expect(new Set(Object.keys(expectedClassification))).toEqual(ruleIds);

    for (const { meta } of rules) {
      const expected = expectedClassification[meta.id];
      if (!expected) {
        throw new Error(`${meta.id} has no expected classification entry`);
      }
      expect(meta.category, `${meta.id} category`).toBe(expected.category);
      expect(meta.evidenceType, `${meta.id} evidenceType`).toBe(expected.evidenceType);
      expect(meta.fixability, `${meta.id} fixability`).toBe(expected.fixability);
      expect(meta.vendorDependence, `${meta.id} vendorDependence`).toBe(expected.vendorDependence);
    }
  });
});

function resetRuleRegistry(): void {
  clearRulesForTests();
  resetBuiltInRuleRegistrationForTests();
}
