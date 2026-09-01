import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDelimitedRows } from "../../src/util/delimited.js";

describe("parseDelimitedRows properties", () => {
  it("never throws on arbitrary text and delimiter", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1, maxLength: 1 }), (text, delimiter) => {
        expect(() => parseDelimitedRows(text, delimiter)).not.toThrow();
      }),
    );
  });

  it("is a pure function: identical input always yields an identical result", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(",", ";", "\t", "|"), (text, delimiter) => {
        expect(parseDelimitedRows(text, delimiter)).toEqual(parseDelimitedRows(text, delimiter));
      }),
    );
  });

  it("round-trips a single unquoted, delimiter-free, newline-free cell", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes(",") && !s.includes('"') && !s.includes("\n") && !s.includes("\r")),
        (cell) => {
          expect(parseDelimitedRows(cell, ",")).toEqual([[cell]]);
        },
      ),
    );
  });

  it("every row has the same cell count as delimiters + 1 for delimiter-only, quote-free, newline-free lines", () => {
    fc.assert(
      fc.property(fc.nat({ max: 20 }), (delimiterCount) => {
        const line = Array.from({ length: delimiterCount + 1 }, (_, index) => `c${index}`).join(",");
        const [row] = parseDelimitedRows(line, ",");
        expect(row).toHaveLength(delimiterCount + 1);
      }),
    );
  });

  it("handles pathologically long unterminated-quote input without hanging or throwing", () => {
    const hostile = `"${"a".repeat(50_000)}`;
    const start = performance.now();
    expect(() => parseDelimitedRows(hostile, ",")).not.toThrow();
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("handles a large number of empty quoted cells without hanging or throwing", () => {
    const hostile = Array.from({ length: 20_000 }, () => '""').join(",");
    const start = performance.now();
    const rows = parseDelimitedRows(hostile, ",");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(20_000);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
