import { describe, expect, it } from "vitest";
import { diffFabrication } from "../../../src/core/diff/fabrication.js";
import { createFinding } from "../../../src/core/findings.js";

describe("fabrication diff", () => {
  it("tracks BOM, manufacturing output, and finding changes with truncation", () => {
    const previousFinding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 is missing an MPN.",
      resource: { path: "bom.csv", kind: "bom" },
    });
    const currentFinding = createFinding({
      ruleId: "design.board-outline",
      severity: "critical",
      message: "Edge.Cuts contour is open.",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
    });

    const diff = diffFabrication(
      {
        bom: [
          { reference: "R1", value: "10k", footprint: "0402" },
          { reference: "D2", value: "LED red" },
        ],
        outputs: [
          { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "same" }] },
          { kind: "drill", files: [{ path: "fab/board.drl", digest: "old" }] },
        ],
      },
      {
        bom: [
          { reference: "R1", value: "10k", footprint: "0402" },
          { reference: "C45", value: "100nF", footprint: "0402" },
        ],
        outputs: [
          { kind: "gerber", files: [{ path: "fab/top.gbr", digest: "same" }] },
          { kind: "drill", files: [{ path: "fab/board.drl", digest: "new" }] },
          { kind: "position", files: [{ path: "fab/board.pos", digest: "new" }] },
        ],
      },
      [previousFinding],
      [currentFinding],
      { maxBomRows: 2 },
    );

    expect(diff.bom).toMatchObject({
      truncated: true,
      rows: [
        { reference: "C45", status: "added" },
        { reference: "D2", status: "removed" },
      ],
    });
    expect(diff.outputs).toEqual([
      { kind: "drill", status: "changed", changed: 1, added: 0, removed: 0 },
      { kind: "gerber", status: "unchanged", changed: 0, added: 0, removed: 0 },
      { kind: "position", status: "added", changed: 0, added: 1, removed: 0 },
    ]);
    expect(diff.findings).toEqual({
      added: [currentFinding],
      removed: [previousFinding],
      unchanged: [],
      worsened: [],
      improved: [],
    });
  });

  it("classifies a finding present in both snapshots as worsened or improved when its severity changes", () => {
    const stableFinding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "medium",
      message: "R1 is missing an MPN.",
      resource: { path: "bom.csv", kind: "bom" },
    });
    const worsenedPrevious = createFinding({
      ruleId: "design.clearance",
      severity: "low",
      message: "Clearance is tight.",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
      fingerprint: "shared-fingerprint",
    });
    const worsenedCurrent = { ...worsenedPrevious, severity: "critical" as const };

    const diff = diffFabrication(
      { bom: [], outputs: [] },
      { bom: [], outputs: [] },
      [stableFinding, worsenedPrevious],
      [stableFinding, worsenedCurrent],
    );

    expect(diff.findings.unchanged).toEqual([stableFinding, worsenedCurrent]);
    expect(diff.findings.worsened).toEqual([{ finding: worsenedCurrent, previousSeverity: "low" }]);
    expect(diff.findings.improved).toEqual([]);

    const reverseDiff = diffFabrication(
      { bom: [], outputs: [] },
      { bom: [], outputs: [] },
      [worsenedCurrent],
      [worsenedPrevious],
    );
    expect(reverseDiff.findings.worsened).toEqual([]);
    expect(reverseDiff.findings.improved).toEqual([{ finding: worsenedPrevious, previousSeverity: "critical" }]);
  });

  it("uses default limits and marks changed BOM rows and removed outputs", () => {
    const initial = diffFabrication(
      undefined,
      {
        bom: [{ reference: "R1", value: "10k" }],
        outputs: [{ kind: "drill", files: [{ path: "fab/board.drl", digest: "old" }] }],
      },
      [],
      [],
    );
    const next = diffFabrication(
      {
        bom: [{ reference: "R1", value: "10k" }],
        outputs: [{ kind: "drill", files: [{ path: "fab/board.drl", digest: "old" }] }],
      },
      {
        bom: [{ reference: "R1", value: "22k" }],
        outputs: [],
      },
      [],
      [],
    );

    expect(initial.bom.rows).toContainEqual({
      reference: "R1",
      previous: "",
      current: "10k",
      status: "added",
    });
    expect(initial.outputs).toEqual([{ kind: "drill", status: "added", changed: 0, added: 1, removed: 0 }]);
    expect(next.bom.rows).toContainEqual({
      reference: "R1",
      previous: "10k",
      current: "22k",
      status: "changed",
    });
    expect(next.outputs).toEqual([{ kind: "drill", status: "removed", changed: 0, added: 0, removed: 1 }]);
  });

  it("keeps changed BOM rows ahead of unchanged rows when diffs are truncated", () => {
    const diff = diffFabrication(
      {
        bom: [
          { reference: "A1", value: "same" },
          { reference: "Z1", value: "old" },
        ],
        outputs: [],
      },
      {
        bom: [
          { reference: "A1", value: "same" },
          { reference: "Z1", value: "new" },
        ],
        outputs: [],
      },
      [],
      [],
      { maxBomRows: 1 },
    );

    expect(diff.bom).toMatchObject({
      truncated: true,
      rows: [{ reference: "Z1", status: "changed" }],
    });
  });

  it("marks non-display BOM metadata and duplicate references from other sources as changes", () => {
    const diff = diffFabrication(
      {
        bom: [
          { sourcePath: "main/bom.csv", reference: "R1", mpn: "R-10K", manufacturer: "Acme" },
          { sourcePath: "child/bom.csv", reference: "R1", mpn: "R-10K", suppliers: ["LCSC"] },
        ],
        outputs: [],
      },
      {
        bom: [
          { sourcePath: "main/bom.csv", reference: "R1", mpn: "R-10K", manufacturer: "BoardWorks" },
          { sourcePath: "child/bom.csv", reference: "R1", mpn: "R-10K", suppliers: ["DigiKey"] },
        ],
        outputs: [],
      },
      [],
      [],
    );

    expect(diff.bom.rows).toEqual([
      expect.objectContaining({ reference: "R1", status: "changed" }),
      expect.objectContaining({ reference: "R1", status: "changed" }),
    ]);
  });
});
