import { describe, expect, it } from "vitest";
import { canonicalizeJson, canonicalizeJsonBuffer, parseJsonValue } from "../../../src/util/json.js";

describe("src/util/json.ts", () => {
  describe("parseJsonValue", () => {
    it("parses valid JSON string", () => {
      expect(parseJsonValue('{"a":1,"b":"text"}')).toEqual({ a: 1, b: "text" });
    });

    it("returns undefined for malformed JSON", () => {
      expect(parseJsonValue("not a json string {")).toBeUndefined();
    });
  });

  describe("canonicalizeJson (RFC 8785)", () => {
    it("sorts object keys lexicographically by UTF-16 code units", () => {
      const input = { z: 1, a: 2, m: 3, B: 4 };
      expect(canonicalizeJson(input)).toBe('{"B":4,"a":2,"m":3,"z":1}');
    });

    it("handles deeply nested objects and arrays deterministically", () => {
      const input1 = {
        b: [{ y: 1, x: 2 }, 3],
        a: { beta: true, alpha: null },
      };
      const input2 = {
        a: { alpha: null, beta: true },
        b: [{ x: 2, y: 1 }, 3],
      };
      expect(canonicalizeJson(input1)).toBe('{"a":{"alpha":null,"beta":true},"b":[{"x":2,"y":1},3]}');
      expect(canonicalizeJson(input1)).toBe(canonicalizeJson(input2));
    });

    it("omits undefined properties in objects and replaces them with null in arrays", () => {
      const input = {
        defined: "yes",
        omitted: undefined,
        arr: [1, undefined, "three"],
      };
      expect(canonicalizeJson(input)).toBe('{"arr":[1,null,"three"],"defined":"yes"}');
    });

    it("handles -0, NaN, and Infinity correctly", () => {
      expect(canonicalizeJson(-0)).toBe("0");
      expect(canonicalizeJson(Number.NaN)).toBe("null");
      expect(canonicalizeJson(Number.POSITIVE_INFINITY)).toBe("null");
    });

    it("produces identical byte buffer", () => {
      const buf = canonicalizeJsonBuffer({ foo: "bar" });
      expect(buf).toEqual(Buffer.from('{"foo":"bar"}', "utf8"));
    });
  });
});
