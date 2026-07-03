import { describe, expect, it } from "vitest";
import { diffFabrication } from "../../../src/core/diff/fabrication.js";
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

  it("treats every current BOM row as added when there is no previous snapshot", () => {
    const diff = diffFabrication(
      undefined,
      {
        bom: [
          { reference: "R2", value: "1k", mpn: "KEEP-2" },
          { reference: "R1", value: "10k", mpn: "NEW-1" },
        ],
        outputs: [],
      },
      [],
      [],
    );

    expect(diff.bom.rows.map((row) => [row.reference, row.status])).toEqual([
      ["R1", "added"],
      ["R2", "added"],
    ]);
    expect(diff.bom.truncated).toBe(false);
  });

  it("keeps source-specific BOM rows distinct without leaking row keys into references", () => {
    const diff = diffFabrication(
      { bom: [{ reference: "R1", sourcePath: "prototype.csv", value: "10k", mpn: "PROTO" }], outputs: [] },
      { bom: [{ reference: "R1", sourcePath: "production.csv", value: "10k", mpn: "PROD" }], outputs: [] },
      [],
      [],
    );

    expect(diff.bom.rows).toEqual([
      { reference: "R1", previous: "", current: "PROD", status: "added" },
      { reference: "R1", previous: "PROTO", current: "", status: "removed" },
    ]);
  });

  it("only marks the BOM diff truncated when there are more rows than the configured limit", () => {
    const exactLimit = diffFabrication(
      undefined,
      { bom: [{ reference: "R1", value: "10k", mpn: "A" }], outputs: [] },
      [],
      [],
      { maxBomRows: 1 },
    );
    const overLimit = diffFabrication(
      undefined,
      {
        bom: [
          { reference: "R1", value: "10k", mpn: "A" },
          { reference: "R2", value: "1k", mpn: "B" },
        ],
        outputs: [],
      },
      [],
      [],
      { maxBomRows: 1 },
    );

    expect(exactLimit.bom.rows).toHaveLength(1);
    expect(exactLimit.bom.truncated).toBe(false);
    expect(overLimit.bom.rows).toHaveLength(1);
    expect(overLimit.bom.truncated).toBe(true);
  });

  it("sorts changed BOM rows before unchanged rows while preserving alphabetical order", () => {
    const diff = diffFabrication(
      {
        bom: [
          { reference: "A1", value: "old", mpn: "OLD-A" },
          { reference: "B1", value: "same", mpn: "SAME-B" },
          { reference: "C1", value: "old", mpn: "OLD-C" },
        ],
        outputs: [],
      },
      {
        bom: [
          { reference: "A1", value: "new", mpn: "NEW-A" },
          { reference: "B1", value: "same", mpn: "SAME-B" },
          { reference: "C1", value: "new", mpn: "NEW-C" },
        ],
        outputs: [],
      },
      [],
      [],
    );

    expect(diff.bom.rows.map((row) => [row.reference, row.status])).toEqual([
      ["A1", "changed"],
      ["C1", "changed"],
      ["B1", "unchanged"],
    ]);
  });
});