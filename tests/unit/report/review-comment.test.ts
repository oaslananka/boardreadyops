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
});
