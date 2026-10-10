import { describe, expect, it } from "vitest";
import {
  findingDomainFromRule,
  findingGuidance,
  githubFindingSourceUrl,
} from "../../../apps/web/lib/finding-guidance.js";

describe("finding remediation guidance", () => {
  it.each([
    ["erc.footprint_filter", "electrical", "Footprint Filters"],
    ["erc.four_way_junction", "electrical", "four-way junction"],
    ["erc.label_dangling", "electrical", "schematic label"],
    ["drc.silk_edge_clearance", "electrical", "Edge.Cuts"],
    ["drc.lib_footprint_issues", "electrical", "footprint library"],
    ["bom.missing-mpn", "sourcing", "manufacturer part number"],
    ["release.changelog-present", "release", "CHANGELOG.md"],
    ["manufacturing.outputs-present", "manufacturability", "current source revision"],
  ])("provides actionable, scoped instructions for %s", (ruleId, domain, phrase) => {
    expect(findingDomainFromRule(ruleId)).toBe(domain);
    expect(findingGuidance(ruleId)).toContain(phrase);
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
