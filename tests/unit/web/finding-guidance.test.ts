import { describe, expect, it } from "vitest";
import {
  findingDomainFromRule,
  findingGuidance,
  githubFindingSourceUrl,
} from "../../../apps/web/lib/finding-guidance.js";
import { catalogRules } from "../../../apps/web/lib/rule-catalog.js";

describe("finding remediation guidance", () => {
  it("uses the engine's declared category for every known rule instead of a misleading prefix", () => {
    const mismatches = catalogRules
      .filter((rule) => findingDomainFromRule(rule.id) !== rule.category)
      .map((rule) => ({ id: rule.id, expected: rule.category, actual: findingDomainFromRule(rule.id) }));
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["bom.dnp-consistency", "assembly"],
    ["bom.footprint-mismatch", "manufacturability"],
    ["design.unique-references", "assembly"],
    ["firmware.dependency-identification", "sourcing"],
    ["manufacturing.test-points", "testability"],
  ])("shows the authoritative category for %s", (ruleId, category) => {
    expect(findingDomainFromRule(ruleId)).toBe(category);
  });

  it.each([
    ["erc.footprint_filter", "electrical", "Footprint Filters"],
    ["erc.four_way_junction", "electrical", "four-way junction"],
    ["erc.label_dangling", "electrical", "schematic label"],
    ["drc.silk_edge_clearance", "electrical", "Edge.Cuts"],
    ["drc.lib_footprint_issues", "electrical", "footprint library"],
    ["bom.missing-mpn", "sourcing", "manufacturer part number"],
    ["release.changelog-present", "release", "CHANGELOG.md"],
    ["manufacturing.outputs-present", "manufacturability", "current source revision"],
    ["manufacturing.fab-notes", "manufacturability", "fab/README.md"],
    ["manufacturing.drill-coverage", "manufacturability", "Excellon"],
    ["manufacturing.package-completeness", "manufacturability", "drill report/map"],
    ["release.revision-set", "release", "PCB title-block revision"],
    ["release.tag-matches-revision", "release", "Git release tag"],
    ["release.version-format", "release", "version pattern"],
    ["release.artifact-provenance", "release", "self-reported hashes"],
    ["bom.unknown-lifecycle", "sourcing", "attributable component data source"],
  ])("provides actionable, scoped instructions for %s", (ruleId, domain, phrase) => {
    expect(findingDomainFromRule(ruleId)).toBe(domain);
    expect(findingGuidance(ruleId)).toContain(phrase);
  });

  it.each(["drc.kicad-cli-unavailable", "erc.kicad-cli-unavailable"])(
    "treats %s as a missing runner dependency, not a CAD defect",
    (ruleId) => {
      const guidance = findingGuidance(ruleId);
      expect(findingDomainFromRule(ruleId)).toBe("electrical");
      expect(guidance).toContain("kicad-cli was unavailable");
      expect(guidance).toContain("PATH");
      expect(guidance).toContain("require-kicad: true");
      expect(guidance).toContain("same source commit");
      expect(guidance).not.toContain("correct the relevant");
    },
  );

  it("uses the rule's actual missing-revision diagnostic instead of suggesting a changelog-only fix", () => {
    const advice = findingGuidance(
      "release.changelog-present",
      "CHANGELOG.md cannot be matched because no board revision is set.",
    );
    expect(advice).toContain("PCB title-block revision first");
    expect(advice).toContain("CHANGELOG.md");
    expect(findingGuidance("release.changelog-present", "CHANGELOG.md is missing.")).toContain(
      "Add or update CHANGELOG.md",
    );
    expect(findingGuidance("release.changelog-present", "CHANGELOG.md does not contain release entry 2.0.")).toContain(
      "Add or update CHANGELOG.md",
    );
  });

  it("tells a user to exclude virtual KiCad # references from BOM instead of sourcing an impossible MPN", () => {
    for (const message of [
      "#PWR010 is missing an MPN.",
      "#FLG01 is missing an MPN.",
      "KiCad virtual symbol #PWR010 was included in the exported BOM. Exclude it from the exported BOM.",
    ]) {
      const guidance = findingGuidance("bom.missing-mpn", message);
      expect(guidance).toContain("Exclude from BOM");
      expect(guidance).not.toContain("Supply a verifiable manufacturer part number");
    }
    expect(findingGuidance("bom.missing-mpn", "R1 is missing an MPN.")).toContain("manufacturer part number");
  });

  it("never tells a release documentation error to edit a CAD design file", () => {
    const message = findingGuidance("release.changelog-present");
    expect(message).not.toContain("CAD");
    expect(message).toContain("commit");
  });

  it("never fabricates coordinates or a particular refdes when details were not returned", () => {
    expect(findingGuidance("erc.unrecognized")).toContain("schematic");
    expect(findingGuidance("unknown.rule")).toContain("original workflow evidence");
    expect(findingDomainFromRule("unknown.rule")).toBe("unclassified");
  });
});

describe("safe GitHub source file deep links", () => {
  const sha = "a".repeat(40);
  it("links only to the exact verified source revision", () => {
    expect(githubFindingSourceUrl("octo/hardware", sha, "board rev/main.kicad_pcb")).toBe(
      `https://github.com/octo/hardware/blob/${sha}/board%20rev/main.kicad_pcb`,
    );
  });
  it.each([
    ".",
    "../secret",
    "/absolute/path",
    "sub/../../secret",
    "dir\\file",
    "a?token=secret",
    "a#fragment",
    "a//b",
    "a\nsecret",
  ])("does not make an untrusted file path navigable: %j", (path) =>
    expect(githubFindingSourceUrl("octo/hardware", sha, path)).toBeUndefined(),
  );
  it("rejects invalid source revisions and owner names", () => {
    expect(githubFindingSourceUrl("octo/hardware", "main", "board.kicad_pcb")).toBeUndefined();
    expect(githubFindingSourceUrl("octo@attacker/hardware", sha, "board.kicad_pcb")).toBeUndefined();
  });
});
