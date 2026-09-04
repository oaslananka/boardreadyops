import { describe, expect, it } from "vitest";
import type { HardwareImpactV1 } from "../../../src/core/diff/hardware-impact.js";
import { createFinding, type Finding, type FindingSummary } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";
import { formatReviewComment } from "../../../src/report/review-comment.js";

function summary(findings: Finding[]): FindingSummary {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    total: findings.length,
    ...counts,
    maxSeverity: findings.length > 0 ? "high" : "none",
    failed: findings.some((finding) => finding.severity === "high" || finding.severity === "critical"),
  };
}

function finding(ruleId: string, severity: Finding["severity"], message: string, path: string, line?: number): Finding {
  return createFinding({
    ruleId,
    severity,
    message,
    resource: { path, kind: "pcb" },
    confidence: "high",
    ...(line ? { location: { line } } : {}),
  });
}

function result(findings: Finding[]): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.0" },
    summary: summary(findings),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-06-22T00:00:00.000Z",
  };
}

function impact(overrides: Partial<HardwareImpactV1> = {}): HardwareImpactV1 {
  return {
    version: 1,
    baseline: { status: "available", sha: "a".repeat(40) },
    candidate: { sha: "b".repeat(40) },
    facts: {
      readiness: {
        previousScore: 82,
        currentScore: 71,
        scoreDelta: -11,
        previousStatus: "ready",
        currentStatus: "at-risk",
        statusChanged: true,
      },
      findings: { added: 2, resolved: 1, addedBlocking: 1, resolvedBlocking: 0 },
      bom: { added: 1, removed: 0, changed: 2, truncated: false },
      manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
    },
    assessment: {
      materialChange: true,
      riskDirection: "increased",
      affectedDomains: ["readiness", "findings", "bom"],
    },
    evidence: [],
    ...overrides,
  };
}

describe("formatReviewComment", () => {
  it("renders a FAIL decision, severity table, and findings grouped by severity", () => {
    const findings = [
      finding("design.board-outline", "high", "PCB outline is open.", "demo.kicad_pcb"),
      finding("bom.missing-mpn", "high", "R1 is missing an MPN.", "bom.csv", 2),
      finding("design.copper-balance", "low", "Low copper coverage.", "demo.kicad_pcb"),
    ];
    const body = formatReviewComment(result(findings), [{ label: "JSON report", url: "https://example/run" }]);

    expect(body).toContain("<!-- boardreadyops:sticky:v1 -->");
    expect(body).toContain("Decision: ❌ FAIL");
    expect(body).toContain("| Severity | Count |");
    expect(body).toContain("### Top findings");
    expect(body).toMatch(/\*\*High\*\* \(2\)/);
    expect(body).toContain("`design.board-outline`");
    expect(body).toContain("`bom.csv:2`");
    expect(body).toContain("[JSON report](https://example/run)");
  });

  it("renders a by-domain breakdown table when the run result carries one", () => {
    const findings = [
      finding("drc.clearance", "critical", "Clearance violation.", "board.kicad_pcb"),
      finding("bom.missing-mpn", "medium", "R1 is missing an MPN.", "bom.csv"),
    ];
    const withCategoryBreakdown: RunResult = {
      ...result(findings),
      categoryBreakdown: [
        { category: "electrical", total: 1, critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        { category: "manufacturability", total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        { category: "assembly", total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        { category: "testability", total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        { category: "sourcing", total: 1, critical: 0, high: 0, medium: 1, low: 0, info: 0 },
        { category: "release", total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      ],
    };

    const body = formatReviewComment(withCategoryBreakdown);

    expect(body).toContain("### By domain");
    expect(body).toContain("| Electrical | 1 | 1 |");
    expect(body).toContain("| Sourcing / BOM | 1 | 0 |");
    expect(body).not.toContain("| Assembly (DFA) | 0 |");
  });

  it("omits the by-domain section when no category breakdown is present (older/legacy run results)", () => {
    const body = formatReviewComment(result([finding("design.board-outline", "high", "x", "y.kicad_pcb")]));
    expect(body).not.toContain("### By domain");
  });

  it("renders a PASS decision with no findings", () => {
    const body = formatReviewComment(result([]));
    expect(body).toContain("Decision: ✅ PASS");
    expect(body).toContain("No blocking findings");
    expect(body).not.toContain("### Reports");
  });

  it("caps each severity group and notes the remainder", () => {
    const findings = Array.from({ length: 5 }, (_, index) =>
      finding(`rule.${index}`, "high", `finding ${index}`, "board.kicad_pcb"),
    );
    const body = formatReviewComment(result(findings));
    expect(body).toContain("…and 2 more.");
  });

  it("renders BOM supply-chain risk section when bomRisk is present", () => {
    const resultWithRisk: RunResult = {
      ...result([]),
      bomRisk: {
        totalComponents: 3,
        overallRiskScore: 65,
        overallRiskLevel: "critical",
        criticalCount: 1,
        highCount: 1,
        mediumCount: 1,
        lowCount: 0,
        components: [
          {
            reference: "U1",
            mpn: undefined,
            manufacturer: undefined,
            riskScore: 80,
            riskLevel: "critical",
            factors: {
              missingMpn: true,
              missingManufacturer: true,
              noSuppliers: false,
              singleSourceNoAlternates: false,
            },
          },
          {
            reference: "R1",
            mpn: "RES-0402",
            manufacturer: "Yageo",
            riskScore: 40,
            riskLevel: "high",
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: false,
              singleSourceNoAlternates: true,
            },
          },
        ],
      },
    };
    const body = formatReviewComment(resultWithRisk);
    expect(body).toContain("### BOM Supply-Chain Risk");
    expect(body).toContain("65/100");
    expect(body).toContain("`U1`");
    expect(body).toContain("no MPN");
    expect(body).toContain("`R1`");
    expect(body).toContain("single source");
  });

  it("renders release mode badge in decision line when releaseMode is set", () => {
    const productionResult: RunResult = { ...result([]), releaseMode: "production" };
    const body = formatReviewComment(productionResult);
    expect(body).toContain("🏭 production |");
    expect(body).toContain("Decision: ✅ PASS");

    const prototypeResult: RunResult = { ...result([]), releaseMode: "prototype" };
    const protoBody = formatReviewComment(prototypeResult);
    expect(protoBody).toContain("🔬 prototype |");
  });

  it("renders changed facts separately from deterministic impact assessment", () => {
    const body = formatReviewComment({ ...result([]), hardwareImpact: impact() });

    expect(body).toContain("### Hardware impact");
    expect(body).toContain("Material change · risk increased · 3 affected domains");
    expect(body).toContain("#### Changed facts");
    expect(body).toContain("Readiness: 82 → 71 (-11)");
    expect(body).toContain("Findings: +2 / -1; 1 new blocker");
    expect(body).toContain("BOM: 3 changed rows");
    expect(body).toContain("#### Impact assessment");
    expect(body).toContain("Risk direction: increased");
    expect(body).toContain("Affected domains: readiness, findings, bom");
  });

  it("renders an explicit authoritative-comparison warning when the exact base is unavailable", () => {
    const unavailable: HardwareImpactV1 = impact({
      baseline: { status: "unavailable", sha: "a".repeat(40), reason: "invalid-artifact" },
      assessment: { materialChange: false, riskDirection: "unknown", affectedDomains: [] },
      evidence: [],
    });
    const body = formatReviewComment({ ...result([]), hardwareImpact: unavailable });

    expect(body).toContain(
      "Exact base SHA evidence unavailable; the current run result is still valid, but no authoritative PR change comparison was produced.",
    );
    expect(body).not.toContain("invalid-artifact");
  });

  it("includes readiness and enforced policy state in the decision without changing the current result semantics", () => {
    const reviewed: RunResult = {
      ...result([]),
      readiness: {
        score: 88,
        status: "at-risk",
        blocking: 0,
        nonBlocking: 1,
        evidence: [],
        missingRequired: [],
        missingRecommended: [],
        warnings: [],
      },
      policy: { status: "fail", enforced: true, rules: [] },
    };

    const body = formatReviewComment(reviewed);
    expect(body).toContain("Decision: ❌ FAIL");
    expect(body).toContain("readiness 88/100 (at-risk)");
    expect(body).toContain("policy fail");
  });

  it("renders a stable no-change impact assessment with no changed fact rows", () => {
    const noChange = impact({
      facts: {
        readiness: {
          previousScore: 90,
          currentScore: 90,
          scoreDelta: 0,
          previousStatus: "ready",
          currentStatus: "ready",
          statusChanged: false,
        },
        findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
        bom: { added: 0, removed: 0, changed: 0, truncated: false },
        manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
      },
      assessment: { materialChange: false, riskDirection: "unchanged", affectedDomains: [] },
    });

    const body = formatReviewComment({ ...result([]), hardwareImpact: noChange });
    expect(body).toContain("No material change · risk unchanged · 0 affected domains");
    expect(body).toContain("No supported v1 facts changed.");
    expect(body).toContain("Material change: no");
    expect(body).toContain("Affected domains: none");
  });

  it("renders singular BOM and manufacturing changes plus positive and unavailable readiness deltas", () => {
    const singular = impact({
      facts: {
        readiness: {
          previousScore: 70,
          currentScore: 80,
          scoreDelta: 10,
          previousStatus: "at-risk",
          currentStatus: "ready",
          statusChanged: true,
        },
        findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
        bom: { added: 1, removed: 0, changed: 0, truncated: false },
        manufacturing: { outputsAdded: 1, outputsRemoved: 0, outputsChanged: 0 },
      },
      assessment: { materialChange: true, riskDirection: "decreased", affectedDomains: ["manufacturing"] },
    });
    const body = formatReviewComment({ ...result([]), hardwareImpact: singular });
    expect(body).toContain("Material change · risk decreased · 1 affected domain");
    expect(body).toContain("Readiness: 70 → 80 (+10)");
    expect(body).toContain("BOM: 1 changed row");
    expect(body).toContain("Manufacturing: 1 changed output");

    const missingPrevious = impact({
      facts: {
        readiness: {
          previousScore: null,
          currentScore: 73,
          scoreDelta: null,
          previousStatus: null,
          currentStatus: "at-risk",
          statusChanged: true,
        },
        findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
        bom: { added: 0, removed: 0, changed: 0, truncated: false },
        manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
      },
      assessment: { materialChange: true, riskDirection: "unknown", affectedDomains: ["readiness"] },
    });
    const missingBody = formatReviewComment({ ...result([]), hardwareImpact: missingPrevious });
    expect(missingBody).toContain("Readiness: n/a → 73 (n/a)");
  });

  it("renders blocker pluralization and resolved blocker details", () => {
    const blockers = impact({
      facts: {
        readiness: {
          previousScore: 80,
          currentScore: 80,
          scoreDelta: 0,
          previousStatus: "ready",
          currentStatus: "ready",
          statusChanged: false,
        },
        findings: { added: 3, resolved: 2, addedBlocking: 2, resolvedBlocking: 2 },
        bom: { added: 0, removed: 0, changed: 0, truncated: false },
        manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
      },
      assessment: { materialChange: true, riskDirection: "increased", affectedDomains: ["findings"] },
    });

    const body = formatReviewComment({ ...result([]), hardwareImpact: blockers });
    expect(body).toContain("Findings: +3 / -2; 2 new blockers; 2 resolved blockers");
  });

  it("renders plural manufacturing changes", () => {
    const manufacturing = impact({
      facts: {
        readiness: {
          previousScore: 90,
          currentScore: 90,
          scoreDelta: 0,
          previousStatus: "ready",
          currentStatus: "ready",
          statusChanged: false,
        },
        findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
        bom: { added: 0, removed: 0, changed: 0, truncated: false },
        manufacturing: { outputsAdded: 1, outputsRemoved: 1, outputsChanged: 1 },
      },
      assessment: { materialChange: true, riskDirection: "unknown", affectedDomains: ["manufacturing"] },
    });

    expect(formatReviewComment({ ...result([]), hardwareImpact: manufacturing })).toContain(
      "Manufacturing: 3 changed outputs",
    );
  });

  it("renders BOM risk variants with no suppliers and with no active risk rows", () => {
    const noSupplier: RunResult = {
      ...result([]),
      bomRisk: {
        totalComponents: 1,
        overallRiskScore: 50,
        overallRiskLevel: "high",
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        lowCount: 0,
        components: [
          {
            reference: "U2",
            mpn: "PART",
            manufacturer: "Maker",
            riskScore: 50,
            riskLevel: "high",
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: true,
              singleSourceNoAlternates: false,
            },
          },
        ],
      },
    };
    expect(formatReviewComment(noSupplier)).toContain("no suppliers");

    const noAtRisk: RunResult = {
      ...result([]),
      bomRisk: {
        totalComponents: 1,
        overallRiskScore: 0,
        overallRiskLevel: "none",
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        components: [
          {
            reference: "R2",
            mpn: "PART",
            manufacturer: "Maker",
            riskScore: 0,
            riskLevel: "none",
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: false,
              singleSourceNoAlternates: false,
            },
          },
        ],
      },
    };
    expect(formatReviewComment(noAtRisk)).not.toContain("### BOM Supply-Chain Risk");
  });
});
