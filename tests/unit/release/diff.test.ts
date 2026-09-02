import { describe, expect, it } from "vitest";
import { createFinding, type Finding } from "../../../src/core/findings.js";
import type { ReadinessScore } from "../../../src/core/readiness.js";
import { diffReleases, formatReleaseDiffText, type ReleaseSnapshot } from "../../../src/release/diff.js";

function finding(ruleId: string, severity: Finding["severity"]): Finding {
  return createFinding({
    ruleId,
    severity,
    message: `${ruleId} finding`,
    resource: { path: "board.kicad_pcb", kind: "pcb" },
  });
}

function readiness(score: number, status: ReadinessScore["status"], missingRequired: string[]): ReadinessScore {
  return {
    profile: { id: "jlcpcb", name: "JLCPCB", service: "fabrication+assembly" },
    score,
    status,
    blocking: 0,
    nonBlocking: 0,
    evidence: [],
    missingRequired,
    missingRecommended: [],
    warnings: [],
  };
}

const previous: ReleaseSnapshot = {
  fabrication: {
    bom: [
      { reference: "R1", value: "10k", mpn: "OLD-1" },
      { reference: "R2", value: "1k", mpn: "KEEP-2" },
    ],
    outputs: [{ kind: "gerber", files: [{ path: "fab/board.gtl", digest: "a".repeat(64) }] }],
  },
  findings: [finding("bom.missing-mpn", "high"), finding("design.clearance", "medium")],
  readiness: readiness(60, "blocked", ["drill", "gerber"]),
};

const current: ReleaseSnapshot = {
  fabrication: {
    bom: [
      { reference: "R1", value: "10k", mpn: "NEW-1" },
      { reference: "R2", value: "1k", mpn: "KEEP-2" },
      { reference: "R3", value: "100", mpn: "ADDED-3" },
    ],
    outputs: [{ kind: "gerber", files: [{ path: "fab/board.gtl", digest: "b".repeat(64) }] }],
  },
  findings: [finding("design.clearance", "medium"), finding("manufacturing.outputs-present", "critical")],
  readiness: readiness(80, "at-risk", ["gerber"]),
};

describe("release diff engine", () => {
  it("produces a stable diff snapshot for a sample release pair", () => {
    const diff = diffReleases(previous, current, {
      generatedAt: "2026-06-22T00:00:00.000Z",
      toolVersion: "0.0.0-test",
    });
    expect(diff).toMatchSnapshot();
  });

  it("summarizes BOM, output, finding, and readiness changes", () => {
    const diff = diffReleases(previous, current, { generatedAt: "2026-06-22T00:00:00.000Z" });

    expect(diff.summary.bomChanged).toBe(2); // R1 changed, R3 added
    expect(diff.summary.outputsChanged).toBe(1); // gerber digest changed
    expect(diff.summary.findingsAdded).toBe(1); // manufacturing.outputs-present
    expect(diff.summary.findingsRemoved).toBe(1); // bom.missing-mpn
    expect(diff.summary.scoreDelta).toBe(20);
    expect(diff.readiness.statusChanged).toBe(true);
    expect(diff.readiness.resolvedRequired).toEqual(["drill"]);
    expect(diff.readiness.newlyMissingRequired).toEqual([]);
  });

  it("handles a missing previous readiness score", () => {
    const diff = diffReleases({ ...previous, readiness: undefined as unknown as ReadinessScore }, current, {
      generatedAt: "2026-06-22T00:00:00.000Z",
    });
    expect(diff.readiness.previousScore).toBeUndefined();
    expect(diff.readiness.scoreDelta).toBe(80);
  });

  it("renders a readable text summary", () => {
    const diff = diffReleases(previous, current, { generatedAt: "2026-06-22T00:00:00.000Z" });
    const text = formatReleaseDiffText(diff);

    expect(text).toContain("readiness: 60 -> 80 (+20)");
    expect(text).toContain("status: blocked -> at-risk");
    expect(text).toContain("resolved required: drill");
    expect(text).toContain("findings: +1 / -1");
  });

  it("lists which bom rows, outputs, and findings actually changed, not just their counts", () => {
    const diff = diffReleases(previous, current, { generatedAt: "2026-06-22T00:00:00.000Z" });
    const text = formatReleaseDiffText(diff);

    expect(text).toContain("bom row changes:");
    expect(text).toContain("R1: OLD-1 -> NEW-1");
    expect(text).toContain("R3: added (ADDED-3)");
    expect(text).not.toContain("R2:");

    expect(text).toContain("output changes:");
    expect(text).toContain("gerber: changed");

    expect(text).toContain("new findings:");
    expect(text).toContain("critical manufacturing.outputs-present at board.kicad_pcb");
    expect(text).toContain("resolved findings:");
    expect(text).toContain("high bom.missing-mpn at board.kicad_pcb");
  });

  it("truncates long change lists with an overflow note instead of flooding the output", () => {
    const manyBom = Array.from({ length: 25 }, (_, index) => ({
      reference: `R${index}`,
      value: "1k",
      mpn: `MPN-${index}`,
    }));
    const diff = diffReleases(
      { fabrication: { bom: [], outputs: [] }, findings: [] },
      { fabrication: { bom: manyBom, outputs: [] }, findings: [] },
      { generatedAt: "2026-06-22T00:00:00.000Z" },
    );
    const text = formatReleaseDiffText(diff);

    // Rows sort alphabetically (R0, R1, R10..R19, R2, R20..R24, R3, R4, R5, ...), so the first
    // 20 of 25 are R0, R1, R10-R19, R2, R20-R24, R3, R4 -- R5 is the first to be dropped.
    expect(text).toContain("R4: added (MPN-4)");
    expect(text).not.toContain("R5: added");
    expect(text).toContain("(+5 more)");
  });

  it("counts and lists findings whose severity changed between snapshots, separate from added/removed", () => {
    const stable = finding("bom.missing-mpn", "high");
    const worsenedBefore = createFinding({
      ruleId: "design.clearance",
      severity: "low",
      message: "Clearance is tight.",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
      fingerprint: "shared-fingerprint",
    });
    const worsenedAfter = { ...worsenedBefore, severity: "critical" as const };

    const diff = diffReleases(
      { fabrication: { bom: [], outputs: [] }, findings: [stable, worsenedBefore] },
      { fabrication: { bom: [], outputs: [] }, findings: [stable, worsenedAfter] },
      { generatedAt: "2026-06-22T00:00:00.000Z" },
    );

    expect(diff.summary.findingsWorsened).toBe(1);
    expect(diff.summary.findingsImproved).toBe(0);
    expect(diff.fabrication.findings.worsened).toEqual([{ finding: worsenedAfter, previousSeverity: "low" }]);

    const text = formatReleaseDiffText(diff);
    expect(text).toContain("~1 worse / ~0 better");
    expect(text).toContain("worsened findings:");
    expect(text).toContain("low -> critical design.clearance at board.kicad_pcb");
    expect(text).not.toContain("improved findings:");
  });

  it("reports the true bom-changed count even when the row list itself is capped", () => {
    const manyBom = Array.from({ length: 25 }, (_, index) => ({
      reference: `R${index}`,
      value: "1k",
      mpn: `MPN-${index}`,
    }));
    const diff = diffReleases(
      { fabrication: { bom: [], outputs: [] }, findings: [] },
      { fabrication: { bom: manyBom, outputs: [] }, findings: [] },
      { generatedAt: "2026-06-22T00:00:00.000Z" },
    );

    // diffFabrication's own maxBomRows default (20) caps diff.fabrication.bom.rows, but the
    // summary must reflect all 25 rows that actually changed, not just the 20 that are listed.
    expect(diff.fabrication.bom.rows).toHaveLength(20);
    expect(diff.fabrication.bom.addedCount).toBe(25);
    expect(diff.summary.bomChanged).toBe(25);
    expect(formatReleaseDiffText(diff)).toContain("bom rows changed: 25");
  });
});
