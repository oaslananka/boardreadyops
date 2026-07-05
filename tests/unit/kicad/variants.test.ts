import { describe, expect, it } from "vitest";
import { activeVariantDnpRefs, parseVariants } from "../../../src/kicad/variants.js";

describe("KiCad 10 variants", () => {
  it("parses JSON project variant DNP overrides", () => {
    const variants = parseVariants(
      JSON.stringify({
        board: {
          variants: [
            { name: "production", dnpOverrides: ["R2"] },
            { name: "prototype", dnp_overrides: ["C3"] },
          ],
        },
      }),
    );

    expect(variants).toEqual([
      { name: "production", dnpOverrides: ["R2"] },
      { name: "prototype", dnpOverrides: ["C3"] },
    ]);
  });

  it("keeps active variant DNP refs limited to known components", () => {
    expect(activeVariantDnpRefs({ name: "production", dnpOverrides: ["R2", "C9"] }, ["R1", "R2"])).toEqual(["R2"]);
  });

  it("matches DNP overrides case-insensitively against base component references", () => {
    expect(activeVariantDnpRefs({ name: "production", dnpOverrides: ["r2", "c9"] }, ["R1", "R2", "C3"])).toEqual([
      "r2",
    ]);
    expect(activeVariantDnpRefs({ name: "production", dnpOverrides: ["R2"] }, ["r1", "r2"])).toEqual(["R2"]);
  });

  it("parses nested S-expression variant DNP overrides", () => {
    expect(parseVariants('(project (variants (variant "proto" (dnp "C1") (dnp_override "R2"))))')).toEqual([
      { name: "proto", dnpOverrides: ["C1", "R2"] },
    ]);
  });

  it("deduplicates variants by name and keeps the first occurrence", () => {
    const variants = parseVariants(
      JSON.stringify({
        variants: [
          { name: "production", dnpOverrides: ["R1"] },
          { name: "prototype", dnpOverrides: ["R2"] },
          { name: "production", dnpOverrides: ["R3"] },
        ],
      }),
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]).toEqual({ name: "production", dnpOverrides: ["R1"] });
    expect(variants[1]).toEqual({ name: "prototype", dnpOverrides: ["R2"] });
  });

  it("parses variants from the variant_definitions key", () => {
    const variants = parseVariants(
      JSON.stringify({
        variant_definitions: [{ name: "custom", dnpOverrides: ["C1", "C2"] }],
      }),
    );

    expect(variants).toEqual([{ name: "custom", dnpOverrides: ["C1", "C2"] }]);
  });

  it("normalizes whitespace in variant names and rejects empty names", () => {
    const variants = parseVariants(
      JSON.stringify({
        variants: [
          { name: "  trimmed  ", dnpOverrides: [] },
          { name: "   ", dnpOverrides: [] },
          { name: "", dnpOverrides: [] },
        ],
      }),
    );

    expect(variants).toHaveLength(1);
    expect(variants[0]?.name).toBe("trimmed");
  });

  it("uses the dnp field alias when dnpOverrides is absent", () => {
    const variants = parseVariants(
      JSON.stringify({
        variants: [{ name: "production", dnp: ["R1", "R2"] }],
      }),
    );

    expect(variants).toEqual([{ name: "production", dnpOverrides: ["R1", "R2"] }]);
  });

  it("returns an empty DNP list when the dnp field is not an array", () => {
    const variants = parseVariants(
      JSON.stringify({
        variants: [{ name: "production", dnpOverrides: "R1" }],
      }),
    );

    expect(variants).toEqual([{ name: "production", dnpOverrides: [] }]);
  });

  it("filters non-string entries from dnpOverrides arrays", () => {
    const variants = parseVariants(
      JSON.stringify({
        variants: [{ name: "production", dnpOverrides: ["R1", 42, null, "R2"] }],
      }),
    );

    expect(variants).toEqual([{ name: "production", dnpOverrides: ["R1", "R2"] }]);
  });

  it("ignores S-expression variants with no name and deduplicates by name", () => {
    expect(
      parseVariants(
        '(project (variants (variant "proto" (dnp "C1")) (variant "" (dnp "C2")) (variant "proto" (dnp "R1"))))',
      ),
    ).toEqual([{ name: "proto", dnpOverrides: ["C1"] }]);
  });
});
