import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadYamlContent } from "../../src/core/config.js";

describe("loadYamlContent properties", () => {
  it("never fails with anything other than a catchable Error, for arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        try {
          loadYamlContent(text);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
    );
  });

  it("is a pure function: identical input always yields an identical result or an equivalent error", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const first = tryLoad(text);
        const second = tryLoad(text);
        if (first.threw || second.threw) {
          expect(first.threw).toBe(true);
          expect(second.threw).toBe(true);
          if (first.threw && second.threw) {
            expect((second.error as Error).message).toBe((first.error as Error).message);
          }
        } else {
          expect(second.value).toEqual(first.value);
        }
      }),
    );
  });

  it("rejects deeply nested flow-sequence YAML without hanging, instead of crashing the process", () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 2_000 }), (depth) => {
        const hostile = "[".repeat(depth) + "]".repeat(depth);
        const start = performance.now();
        try {
          loadYamlContent(hostile);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        expect(performance.now() - start).toBeLessThan(1_000);
      }),
    );
  });

  it("handles a pathologically long scalar without hanging or crashing", () => {
    const hostile = `key: "${"a".repeat(200_000)}"`;
    const start = performance.now();
    expect(() => loadYamlContent(hostile)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("does not expand anchor/alias references into an exponential ('billion laughs') blow-up", () => {
    // Each alias level doubles the prior list; unmitigated, 30 levels would materialize
    // roughly 2^30 (~1 billion) entries in memory before returning.
    const lines = ['a: &a ["x"]'];
    for (let level = 1; level <= 30; level += 1) {
      lines.push(
        `a${level}: &a${level} [*a${level - 1 === 0 ? "a" : `a${level - 1}`}, *a${level - 1 === 0 ? "a" : `a${level - 1}`}]`,
      );
    }
    const hostile = lines.join("\n");
    const start = performance.now();
    try {
      loadYamlContent(hostile);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

function tryLoad(text: string): { threw: false; value: unknown } | { threw: true; error: unknown } {
  try {
    return { threw: false, value: loadYamlContent(text) };
  } catch (error) {
    return { threw: true, error };
  }
}
