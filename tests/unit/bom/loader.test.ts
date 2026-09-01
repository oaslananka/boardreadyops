import { describe, expect, it } from "vitest";
import { parseDelimited } from "../../../src/bom/loader.js";

describe("parseDelimited", () => {
  it("maps rows to header-keyed records", () => {
    const rows = parseDelimited("Reference,Value,Footprint\nR1,10k,0603\nR2,4.7k,0603\n");
    expect(rows).toEqual([
      { Reference: "R1", Value: "10k", Footprint: "0603" },
      { Reference: "R2", Value: "4.7k", Footprint: "0603" },
    ]);
  });

  it("skips blank rows", () => {
    const rows = parseDelimited("Reference,Value\nR1,10k\n,\nR2,4.7k\n");
    expect(rows).toEqual([
      { Reference: "R1", Value: "10k" },
      { Reference: "R2", Value: "4.7k" },
    ]);
  });

  it("preserves data under duplicate header names instead of silently overwriting it", () => {
    const rows = parseDelimited("Reference,Value,Value\nR1,10k,25V\n");
    expect(rows).toEqual([{ Reference: "R1", Value: "10k", Value_2: "25V" }]);
  });

  it("suffixes every repeat of a triplicated header", () => {
    const rows = parseDelimited("Note,Note,Note\na,b,c\n");
    expect(rows).toEqual([{ Note: "a", Note_2: "b", Note_3: "c" }]);
  });

  it("supports a tab delimiter", () => {
    const rows = parseDelimited("Reference\tValue\nR1\t10k\n", "\t");
    expect(rows).toEqual([{ Reference: "R1", Value: "10k" }]);
  });

  it("fills in an empty string for a row with fewer cells than the header", () => {
    const rows = parseDelimited("Reference,Value,Footprint\nR1,10k\n");
    expect(rows).toEqual([{ Reference: "R1", Value: "10k", Footprint: "" }]);
  });
});
