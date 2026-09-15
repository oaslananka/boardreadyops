import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinding, summarizeFindings } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";
import { clearRulesForTests, type RuleEvidenceType, registerRule } from "../../../src/core/rule-registry.js";
import { formatMarkdown } from "../../../src/report/markdown.js";

/**
 * The report has to show what the verdict rests on. A section added to a template and never
 * rendered is the failure this repository keeps producing, so these tests render the real report
 * and read it, rather than asserting the view object that feeds it. See #753.
 */

function fakeRule(id: string, evidenceType: RuleEvidenceType) {
  return {
    meta: {
      id,
      title: id,
      description: id,
      rationale: id,
      defaultSeverity: "high" as const,
      appliesTo: [],
      configKeys: [],
      kicadVersions: ["10" as const],
      tags: [],
      category: "manufacturability" as const,
      evidenceType,
      fixability: "manual" as const,
      vendorDependence: "none" as const,
    },
    async run() {
      return [];
    },
  };
}

function resultWith(evidence: RunResult["evidence"], findings = [sampleFinding("bom.risk-score", "high")]): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "0.0.0-test" },
    summary: summarizeFindings(findings, "high"),
    ...(evidence ? { evidence } : {}),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-09-15T00:00:00.000Z",
  } as RunResult;
}

function sampleFinding(ruleId: string, severity: "high" | "medium") {
  return createFinding({
    ruleId,
    severity,
    message: `${ruleId} says something`,
    resource: { path: "demo-bom.csv", kind: "bom" },
  });
}

describe("the report's evidence section", () => {
  beforeEach(() => {
    clearRulesForTests();
    registerRule(fakeRule("design.board-outline", "exact"));
    registerRule(fakeRule("bom.risk-score", "heuristic"));
  });

  afterEach(() => {
    clearRulesForTests();
  });

  it("renders the measured and inferred counts", () => {
    const markdown = formatMarkdown(resultWith({ exact: 4, heuristic: 2, unclassified: 0, blockingOnInference: [] }));

    expect(markdown).toContain("What This Rests On");
    expect(markdown).toContain("4 measured, 2 inferred");
  });

  it("names the rules that can block without having measured anything", () => {
    const markdown = formatMarkdown(
      resultWith({ exact: 1, heuristic: 2, unclassified: 0, blockingOnInference: ["bom.risk-score", "mfg.fab-notes"] }),
    );

    expect(markdown).toContain("can fail the run and do not rest on a measurement");
    expect(markdown).toContain("`bom.risk-score`");
    expect(markdown).toContain("`mfg.fab-notes`");
  });

  it("leaves out the blocking paragraph when every blocking finding was measured", () => {
    const markdown = formatMarkdown(resultWith({ exact: 3, heuristic: 1, unclassified: 0, blockingOnInference: [] }));

    // The counts still appear; the warning does not, because there is nothing to warn about.
    expect(markdown).toContain("3 measured, 1 inferred");
    expect(markdown).not.toContain("do not rest on a measurement");
  });

  it("omits the section entirely on a clean run", () => {
    const markdown = formatMarkdown(
      resultWith({ exact: 0, heuristic: 0, unclassified: 0, blockingOnInference: [] }, []),
    );

    // A heading over three zeroes tells a reader nothing and pushes the verdict down the page.
    expect(markdown).not.toContain("What This Rests On");
  });

  it("omits the section for a result that carries no evidence summary at all", () => {
    // Results produced before this field existed, and any surface that builds a RunResult by hand.
    const markdown = formatMarkdown(resultWith(undefined));
    expect(markdown).not.toContain("What This Rests On");
  });
});
