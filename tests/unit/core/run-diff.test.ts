import { describe, expect, it } from "vitest";
import { diffRuns } from "../../../src/core/diff/run.js";
import { createFinding } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "0.0.0" },
    status: "passed",
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, failed: false },
    findings: [],
    fabrication: { bom: [], outputs: [] },
    projects: [],
    ...overrides,
  } as RunResult;
}

describe("diffRuns", () => {
  it("preserves run timestamps and release mode", () => {
    const previous = makeRun({ generatedAt: "2026-01-01T00:00:00.000Z", releaseMode: "prototype" });
    const current = makeRun({ generatedAt: "2026-02-01T00:00:00.000Z", releaseMode: "production" });

    const diff = diffRuns(previous, current);

    expect(diff.previousGeneratedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(diff.currentGeneratedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(diff.previousReleaseMode).toBe("prototype");
    expect(diff.currentReleaseMode).toBe("production");
  });

  it("computes readiness score delta", () => {
    const previous = makeRun({
      readiness: {
        score: 70,
        status: "at-risk",
        blocking: 0,
        nonBlocking: 2,
        evidence: [],
        missingRequired: [],
        missingRecommended: [],
        warnings: [],
      },
    });
    const current = makeRun({
      readiness: {
        score: 85,
        status: "ready",
        blocking: 0,
        nonBlocking: 0,
        evidence: [],
        missingRequired: [],
        missingRecommended: [],
        warnings: [],
      },
    });

    const diff = diffRuns(previous, current);

    expect(diff.readiness.previousScore).toBe(70);
    expect(diff.readiness.currentScore).toBe(85);
    expect(diff.readiness.scoreDelta).toBe(15);
    expect(diff.readiness.previousStatus).toBe("at-risk");
    expect(diff.readiness.currentStatus).toBe("ready");
    expect(diff.readiness.riskIncreased).toBe(false);
  });

  it("flags risk increased when score drops", () => {
    const previous = makeRun({
      readiness: {
        score: 90,
        status: "ready",
        blocking: 0,
        nonBlocking: 0,
        evidence: [],
        missingRequired: [],
        missingRecommended: [],
        warnings: [],
      },
    });
    const current = makeRun({
      readiness: {
        score: 60,
        status: "blocked",
        blocking: 1,
        nonBlocking: 0,
        evidence: [],
        missingRequired: ["gerber"],
        missingRecommended: [],
        warnings: [],
      },
    });

    const diff = diffRuns(previous, current);

    expect(diff.readiness.riskIncreased).toBe(true);
    expect(diff.readiness.scoreDelta).toBe(-30);
  });

  it("detects conclusion change from passed to failed", () => {
    const previous = makeRun({ status: "passed" });
    const current = makeRun({ status: "failed" });

    const diff = diffRuns(previous, current);

    expect(diff.readiness.conclusionChanged).toBe(true);
  });

  it("handles absent readiness data gracefully", () => {
    const previous = makeRun();
    const current = makeRun();

    const diff = diffRuns(previous, current);

    expect(diff.readiness.previousScore).toBeNull();
    expect(diff.readiness.currentScore).toBeNull();
    expect(diff.readiness.scoreDelta).toBeNull();
  });

  it("categorizes findings as added, resolved, or unchanged", () => {
    const sharedFinding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 missing MPN",
      resource: { path: "bom.csv", kind: "bom" },
    });
    const resolvedFinding = createFinding({
      ruleId: "design.board-outline",
      severity: "critical",
      message: "Edge.Cuts open",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
    });
    const newFinding = createFinding({
      ruleId: "bom.eol-detection",
      severity: "high",
      message: "U1 is EOL",
      resource: { path: "bom.csv", kind: "bom" },
    });

    const previous = makeRun({ findings: [sharedFinding, resolvedFinding] });
    const current = makeRun({ findings: [sharedFinding, newFinding] });

    const diff = diffRuns(previous, current);

    expect(diff.findings.added.map((finding) => finding.ruleId)).toEqual(["bom.eol-detection"]);
    expect(diff.findings.resolved.map((finding) => finding.ruleId)).toEqual(["design.board-outline"]);
    expect(diff.findings.unchanged.map((finding) => finding.ruleId)).toEqual(["bom.missing-mpn"]);
  });

  it("includes fabrication diff for BOM and outputs", () => {
    const previous = makeRun({
      fabrication: {
        bom: [{ reference: "R1", value: "10k" }],
        outputs: [{ kind: "gerber", files: [{ path: "fab/top.gbr", digest: "abc" }] }],
      },
    });
    const current = makeRun({
      fabrication: {
        bom: [
          { reference: "R1", value: "10k" },
          { reference: "C1", value: "100nF" },
        ],
        outputs: [{ kind: "gerber", files: [{ path: "fab/top.gbr", digest: "def" }] }],
      },
    });

    const diff = diffRuns(previous, current);

    expect(diff.fabrication.bom.rows.some((row) => row.reference === "C1" && row.status === "added")).toBe(true);
    expect(diff.fabrication.outputs[0]).toMatchObject({ kind: "gerber", status: "changed" });
  });
});
