import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSexprDocument } from "../../src/kicad/sexpr.js";

describe("parseSexprDocument properties", () => {
  it("never throws on arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => parseSexprDocument(text)).not.toThrow();
      }),
    );
  });

  it("is a pure function: identical input always yields an identical result", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parseSexprDocument(text)).toEqual(parseSexprDocument(text));
      }),
    );
  });

  it("reports unclosed lists instead of silently dropping them, for any run of open parens", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (count) => {
        const document = parseSexprDocument("(".repeat(count));
        expect(document.errors.some((error) => error.message === "Unclosed list")).toBe(true);
      }),
    );
  });

  it("parses a balanced flat list into a single root list node with no errors", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]*$/), { minLength: 1, maxLength: 10 }), (atoms) => {
        const document = parseSexprDocument(`(${atoms.join(" ")})`);
        expect(document.errors).toEqual([]);
        expect(document.nodes).toHaveLength(1);
        const [root] = document.nodes;
        expect(root?.kind).toBe("list");
      }),
    );
  });

  it("rejects nesting beyond the configured depth without hanging, instead of crashing the process", () => {
    fc.assert(
      fc.property(fc.integer({ min: 513, max: 2_000 }), (depth) => {
        const start = performance.now();
        const document = parseSexprDocument("(".repeat(depth));
        expect(performance.now() - start).toBeLessThan(1_000);
        expect(document.errors.some((error) => error.message.includes("Maximum S-expression nesting depth"))).toBe(
          true,
        );
      }),
    );
  });

  it("handles a pathologically long unterminated string without hanging or throwing", () => {
    const hostile = `(net "${"a".repeat(100_000)}`;
    const start = performance.now();
    expect(() => parseSexprDocument(hostile)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
