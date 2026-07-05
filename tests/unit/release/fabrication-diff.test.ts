import { describe, expect, it } from "vitest";
import { diffFabrication } from "../../../src/core/diff/fabrication.js";
import { createFinding } from "../../../src/core/findings.js";

describe("fabrication diff edge cases", () => {
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

  it("keeps source-specific BOM rows distinct without exposing row keys", () => {
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

  it("only marks the BOM diff truncated when rows exceed the configured limit", () => {
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

  it("sorts changed BOM rows before unchanged rows in alphabetical order", () => {
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

  it("detects BOM changes in non-display metadata fields", () => {
    const base = { reference: "U1", value: "MCU", mpn: "MCU-1" };
    const makeDiff = (prev: object, curr: object) =>
      diffFabrication(
        { bom: [{ ...base, ...prev }], outputs: [] },
        { bom: [{ ...base, ...curr }], outputs: [] },
        [],
        [],
      );

    expect(makeDiff({ suppliers: ["LCSC"] }, { suppliers: ["DigiKey"] }).bom.rows[0]?.status).toBe("changed");
    expect(makeDiff({ lifecycle: "Active" }, { lifecycle: "EOL" }).bom.rows[0]?.status).toBe("changed");
    expect(makeDiff({ dnp: false }, { dnp: true }).bom.rows[0]?.status).toBe("changed");
    expect(makeDiff({ quantity: 1 }, { quantity: 2 }).bom.rows[0]?.status).toBe("changed");
    expect(makeDiff({ manufacturer: "Acme" }, { manufacturer: "BoardWorks" }).bom.rows[0]?.status).toBe("changed");
    expect(makeDiff({ footprint: "0402" }, { footprint: "0603" }).bom.rows[0]?.status).toBe("changed");
  });

  it("classifies findings as added, removed, and unchanged based on fingerprint", () => {
    const sharedFinding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 missing MPN.",
      resource: { path: "bom.csv", kind: "bom" },
    });
    const newFinding = createFinding({
      ruleId: "design.clearance",
      severity: "critical",
      message: "Clearance violation.",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
    });
    const oldFinding = createFinding({
      ruleId: "design.outline",
      severity: "medium",
      message: "Outline missing.",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
    });

    const diff = diffFabrication(
      { bom: [], outputs: [] },
      { bom: [], outputs: [] },
      [sharedFinding, oldFinding],
      [sharedFinding, newFinding],
    );

    expect(diff.findings.unchanged).toEqual([sharedFinding]);
    expect(diff.findings.added).toEqual([newFinding]);
    expect(diff.findings.removed).toEqual([oldFinding]);
  });

  it("counts individual file changes within an output kind", () => {
    const diff = diffFabrication(
      {
        bom: [],
        outputs: [
          {
            kind: "gerber",
            files: [
              { path: "fab/top.gbr", digest: "old-top" },
              { path: "fab/bot.gbr", digest: "old-bot" },
              { path: "fab/edge.gbr", digest: "old-edge" },
            ],
          },
        ],
      },
      {
        bom: [],
        outputs: [
          {
            kind: "gerber",
            files: [
              { path: "fab/top.gbr", digest: "new-top" },
              { path: "fab/bot.gbr", digest: "old-bot" },
              { path: "fab/mask.gbr", digest: "new-mask" },
            ],
          },
        ],
      },
      [],
      [],
    );

    expect(diff.outputs).toEqual([{ kind: "gerber", status: "changed", changed: 1, added: 1, removed: 1 }]);
  });
});
