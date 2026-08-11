import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSexprDocument } from "../../../src/kicad/sexpr.js";

describe("S-expression parser", () => {
  it("reports unfinished nested lists from inner to outer without reversing the parser stack in place", () => {
    const document = parseSexprDocument("(a (b (c");
    expect(document.errors.map((error) => error.span.start.column)).toEqual([7, 4, 1]);

    const source = readFileSync("src/kicad/sexpr.ts", "utf8");
    expect(source).toContain("stack.toReversed()");
    expect(source).not.toContain("stack.reverse()");
  });
});
