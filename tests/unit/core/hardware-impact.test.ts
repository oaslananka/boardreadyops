import { describe, expect, it } from "vitest";
import { buildHardwareImpact } from "../../../src/core/diff/hardware-impact.js";
import { createFinding, type Finding } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function finding(ruleId: string, severity: Finding["severity"], message: string, path: string): Finding {
  return createFinding({
    ruleId,
    severity,
    message,
    resource: { path, kind: path.endsWith(".csv") ? "bom" : "pcb" },
  });
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.32.1" },
    status: "passed",
    generatedAt: "2026-08-22T00:00:00.000Z",
    summary: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, failed: false },
    findings: [],
    fabrication: { bom: [], outputs: [] },
    projects: [],
    ...overrides,
  } as RunResult;
}

function readiness(score: number, status: "ready" | "at-risk" | "blocked") {
  return {
    score,
    status,
    blocking: status === "blocked" ? 1 : 0,
    nonBlocking: status === "at-risk" ? 1 : 0,
    evidence: [],
    missingRequired: [],
    missingRecommended: [],
    warnings: [],
  };
}

const shared = finding("bom.missing-mpn", "medium", "R1 missing MPN", "bom.csv");
const resolved = finding("design.copper-balance", "low", "Copper balance warning", "board.kicad_pcb");
const addedBlocking = finding("design.board-outline", "high", "Board outline is open", "board.kicad_pcb");
const addedWarning = finding("bom.lifecycle", "medium", "U1 lifecycle is unknown", "bom.csv");

function previousRun(): RunResult {
  return run({
    readiness: readiness(82, "ready"),
    findings: [shared, resolved],
    fabrication: {
      bom: [
        { reference: "R1", value: "10k", footprint: "0402" },
        { reference: "C1", value: "100nF", footprint: "0402" },
        { reference: "U1", value: "MCU", footprint: "QFN" },
      ],
      outputs: [
        { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "aaa" }] },
        { kind: "drill", files: [{ path: "fab/board.drl", digest: "bbb" }] },
      ],
    },
  });
}

function currentRun(): RunResult {
  return run({
    status: "failed",
    readiness: readiness(71, "at-risk"),
    findings: [shared, addedBlocking, addedWarning],
    fabrication: {
      bom: [
        { reference: "R1", value: "12k", footprint: "0402" },
        { reference: "C1", value: "1uF", footprint: "0402" },
        { reference: "U1", value: "MCU", footprint: "QFN" },
        { reference: "L1", value: "2.2uH", footprint: "0603" },
      ],
      outputs: [
        { kind: "drill", files: [{ path: "fab/board.drl", digest: "bbb" }] },
        { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "ccc" }] },
      ],
    },
  });
}

describe("buildHardwareImpact", () => {
  it("separates exact-base changed facts from deterministic assessment", () => {
    const impact = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previousRun() },
      candidate: { sha: headSha, result: currentRun() },
    });

    expect(impact).toMatchObject({
      version: 1,
      baseline: { status: "available", sha: baseSha },
      candidate: { sha: headSha },
      facts: {
        readiness: { previousScore: 82, currentScore: 71, scoreDelta: -11 },
        findings: { added: 2, resolved: 1, addedBlocking: 1, resolvedBlocking: 0 },
        bom: { added: 1, removed: 0, changed: 2 },
        manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 1 },
      },
      assessment: {
        materialChange: true,
        riskDirection: "increased",
        affectedDomains: ["readiness", "findings", "bom", "manufacturing"],
      },
    });
    expect(impact.evidence.length).toBeLessThanOrEqual(12);
  });

  it("returns identical output for semantically identical inputs in different source order", () => {
    const first = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previousRun() },
      candidate: { sha: headSha, result: currentRun() },
    });
    const previous = previousRun();
    const current = currentRun();
    previous.findings = [...previous.findings].reverse();
    previous.fabrication.outputs = [...previous.fabrication.outputs].reverse();
    current.findings = [...current.findings].reverse();
    current.fabrication.outputs = [...current.fabrication.outputs].reverse();

    const reordered = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(reordered).toEqual(first);
  });

  it("classifies explicit risk reduction as decreased", () => {
    const blocker = finding("design.board-outline", "high", "Board outline is open", "board.kicad_pcb");
    const previous = run({ status: "failed", readiness: readiness(55, "blocked"), findings: [blocker] });
    const current = run({ status: "passed", readiness: readiness(95, "ready"), findings: [] });

    const improved = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(improved.assessment.riskDirection).toBe("decreased");
  });

  it("reports unchanged only when exact-base supported facts are unchanged", () => {
    const previous = run({ readiness: readiness(90, "ready") });
    const current = run({ readiness: readiness(90, "ready") });

    const noChange = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(noChange.assessment).toEqual({
      materialChange: false,
      riskDirection: "unchanged",
      affectedDomains: [],
    });
  });

  it("uses unknown when material facts change without a supported risk-direction signal", () => {
    const previous = run({ fabrication: { bom: [{ reference: "R1", value: "10k" }], outputs: [] } });
    const current = run({ fabrication: { bom: [{ reference: "R1", value: "12k" }], outputs: [] } });

    const unclassifiedChange = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(unclassifiedChange.assessment.riskDirection).toBe("unknown");
    expect(unclassifiedChange.assessment.affectedDomains).toEqual(["bom"]);
  });

  it("treats critical findings as blockers and recognizes resolved blocker risk reduction", () => {
    const critical = finding("design.short", "critical", "Critical short detected", "board.kicad_pcb");
    const previous = run({ status: "failed", findings: [critical] });
    const current = run({ status: "passed", findings: [] });

    const impact = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(impact.facts.findings).toMatchObject({ resolved: 1, resolvedBlocking: 1 });
    expect(impact.assessment.riskDirection).toBe("decreased");
  });

  it("tracks removed BOM rows plus added and removed manufacturing outputs", () => {
    const previous = run({
      fabrication: {
        bom: [
          { reference: "R1", value: "10k" },
          { reference: "C1", value: "100nF" },
        ],
        outputs: [
          { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "aaa" }] },
          { kind: "drill", files: [{ path: "fab/board.drl", digest: "bbb" }] },
        ],
      },
    });
    const current = run({
      fabrication: {
        bom: [{ reference: "R1", value: "10k" }],
        outputs: [
          { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "aaa" }] },
          { kind: "pick-place", files: [{ path: "fab/positions.csv", digest: "ccc" }] },
        ],
      },
    });

    const impact = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(impact.facts.bom).toMatchObject({ removed: 1 });
    expect(impact.facts.manufacturing).toEqual({ outputsAdded: 1, outputsRemoved: 1, outputsChanged: 0 });
    expect(impact.assessment.affectedDomains).toEqual(["bom", "manufacturing"]);
  });

  it("handles readiness appearing for the first time without inventing a score direction", () => {
    const previous = run();
    const current = run({ readiness: readiness(73, "at-risk") });

    const impact = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: previous },
      candidate: { sha: headSha, result: current },
    });

    expect(impact.facts.readiness).toEqual({
      previousScore: null,
      currentScore: 73,
      scoreDelta: null,
      previousStatus: null,
      currentStatus: "at-risk",
      statusChanged: true,
    });
    expect(impact.assessment).toEqual({
      materialChange: true,
      riskDirection: "unknown",
      affectedDomains: ["readiness"],
    });
    expect(impact.evidence[0]?.label).toContain("Readiness n/a → 73; n/a → at-risk");
  });

  it("uses evidence path ordering when otherwise identical finding labels are added", () => {
    const first = finding("design.same-rule", "medium", "Same message", "a-board.kicad_pcb");
    const second = finding("design.same-rule", "medium", "Same message", "b-board.kicad_pcb");
    const impact = buildHardwareImpact({
      baseline: { status: "available", sha: baseSha, result: run() },
      candidate: { sha: headSha, result: run({ findings: [second, first] }) },
    });

    const findingEvidence = impact.evidence.filter((entry) => entry.kind === "finding");
    expect(findingEvidence.map((entry) => entry.path)).toEqual(["a-board.kicad_pcb", "b-board.kicad_pcb"]);
  });

  it("keeps the current run valid while marking missing exact-base evidence unavailable", () => {
    const unavailable = buildHardwareImpact({
      baseline: { status: "unavailable", sha: baseSha, reason: "not-found" },
      candidate: { sha: headSha, result: run({ readiness: readiness(73, "at-risk") }) },
    });

    expect(unavailable).toMatchObject({
      baseline: { status: "unavailable", sha: baseSha, reason: "not-found" },
      candidate: { sha: headSha },
      facts: {
        readiness: {
          previousScore: null,
          currentScore: 73,
          scoreDelta: null,
          previousStatus: null,
          currentStatus: "at-risk",
        },
        findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
      },
      assessment: { materialChange: false, riskDirection: "unknown", affectedDomains: [] },
      evidence: [],
    });
  });

  it("uses null current readiness when exact-base evidence is unavailable and the candidate has no readiness", () => {
    const impact = buildHardwareImpact({
      baseline: { status: "unavailable", sha: baseSha, reason: "unsupported-result" },
      candidate: { sha: headSha, result: run() },
    });

    expect(impact.facts.readiness.currentScore).toBeNull();
    expect(impact.facts.readiness.currentStatus).toBeNull();
  });
});
