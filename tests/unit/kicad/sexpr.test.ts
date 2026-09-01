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

  it("safely handles deeply nested adversarial input exceeding max depth", () => {
    const deepInput = `${"(".repeat(600)}atom${")".repeat(600)}`;
    const document = parseSexprDocument(deepInput);
    expect(document.errors.some((err) => err.message.includes("Maximum S-expression nesting depth"))).toBe(true);
  });
});
