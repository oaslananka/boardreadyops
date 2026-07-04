import { describe, expect, it } from "vitest";
import { diffFabrication } from "../../../src/core/diff/fabrication.js";

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
});
