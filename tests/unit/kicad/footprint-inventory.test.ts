import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifiedPcbFootprintInventory } from "../../../src/kicad/footprint-inventory.js";
import { MAX_KICAD_TEXT_BYTES } from "../../../src/kicad/project-model.js";

const rId = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const cId = "c71b2196-ae56-4853-92ac-5497683704cd";
function footprint(id: string, ref: string, pos = "125.75 20.125 90", layer = "F.Cu"): string {
  return (
    '(footprint "Resistor_SMD:R_0603" (layer "' +
    layer +
    '") (at ' +
    pos +
    ') (uuid "' +
    id +
    '") (property "Reference" "' +
    ref +
    '") (pad "1" smd rect (at 0 0) (uuid "42840aa9-b459-4c93-80e2-8ecb6a1f48d3")))'
  );
}
function board(...parts: string[]): string {
  return ['(kicad_pcb (version 20250114) (generator "pcbnew") ', parts.join("\n"), ")"].join("");
}

describe("verified KiCad source footprint inventory", () => {
  it("returns deterministic root footprint UUIDs, exact physical positions and source digest", () => {
    const source = board(footprint(rId.toUpperCase(), "R1"), footprint(cId, "C2", "15 25", "B.Cu"));
    const result = verifiedPcbFootprintInventory(source);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(result.footprints).toHaveLength(2);
    expect(result.footprints.find((item) => item.sourceUuid === rId)).toMatchObject({
      reference: "R1",
      libraryId: "Resistor_SMD:R_0603",
      layer: "F.Cu",
      positionMm: { x: 125.75, y: 20.125 },
      rotationDeg: 90,
    });
    expect(result.footprints.find((item) => item.sourceUuid === cId)).toMatchObject({
      reference: "C2",
      layer: "B.Cu",
      positionMm: { x: 15, y: 25 },
    });
    expect(result.footprints.map((item) => item.sourceUuid)).toEqual([rId, cId].sort());
  });

  it("never substitutes a reference or nested pad UUID for missing footprint identity", () => {
    expect(
      verifiedPcbFootprintInventory(board(footprint(rId, "R1").replace(['(uuid "', rId, '")'].join(""), ""))),
    ).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
    expect(verifiedPcbFootprintInventory(board(footprint("not-a-uuid", "R1")))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
  });

  it("rejects duplicate UUIDs and rejects the entire inventory for a single incomplete object", () => {
    expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1"), footprint(rId, "R2")))).toEqual({
      status: "unavailable",
      reason: "duplicate-uuid",
    });
    expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1"), footprint(cId, "R2", "bad 5")))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
    expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", "1 2 nope")))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
  });

  it("rejects malformed or different source types, invalid layer and missing reference", () => {
    expect(verifiedPcbFootprintInventory('(kicad_sch (uuid "a"))')).toEqual({
      status: "unavailable",
      reason: "malformed-source",
    });
    expect(verifiedPcbFootprintInventory("(kicad_pcb (footprint")).toEqual({
      status: "unavailable",
      reason: "malformed-source",
    });
    expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", "1 2", "Custom.Layer")))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
    expect(
      verifiedPcbFootprintInventory(board(footprint(rId, "R1").replace('(property "Reference" "R1")', ""))),
    ).toEqual({ status: "unavailable", reason: "missing-source-identity" });
  });

  it("rejects noncanonical library footprint IDs instead of verifying fabricated source identity", () => {
    const source = footprint(rId, "R1");
    for (const invalid of [
      "not-a-library-id",
      ":R_0603",
      "Resistor_SMD:",
      "Resistor_SMD:R_0603:extra",
      " Resistor_SMD:R_0603",
    ]) {
      expect(verifiedPcbFootprintInventory(board(source.replace("Resistor_SMD:R_0603", invalid)))).toEqual({
        status: "unavailable",
        reason: "missing-source-identity",
      });
    }
  });

  it("rejects nonexistent footprint-placement layers despite a plausible side prefix", () => {
    for (const layer of ["F.NotReal", "B.NotReal", "F.SilkS", "B.Mask", "In1.Cu"]) {
      expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", "1 2", layer)))).toEqual({
        status: "unavailable",
        reason: "missing-source-identity",
      });
    }
  });

  it("rejects malformed decimal coordinates, blank rotation and extra placement values", () => {
    for (const position of ["0x10 2", "0b11 2", '1 2 ""', "1 2 3 4", "1 2 1e9999"]) {
      expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", position)))).toEqual({
        status: "unavailable",
        reason: "missing-source-identity",
      });
    }
  });

  it("rejects nested or structurally ambiguous at coordinates rather than inventing rotation", () => {
    for (const position of ["1 2 (offset 3)", "1 2 (rotate 90)", "1 2 (xyz 4 5)"]) {
      expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", position)))).toEqual({
        status: "unavailable",
        reason: "missing-source-identity",
      });
    }
  });

  it("rejects duplicate scalar values in UUID, layer and Reference fields", () => {
    const source = footprint(rId, "R1");
    for (const ambiguous of [
      source.replace(`(uuid "${rId}")`, `(uuid "${rId}" "extra")`),
      source.replace('(layer "F.Cu")', '(layer "F.Cu" "B.Cu")'),
      source.replace('(property "Reference" "R1")', '(property "Reference" "R1" "extra")'),
    ]) {
      expect(verifiedPcbFootprintInventory(board(ambiguous))).toEqual({
        status: "unavailable",
        reason: "missing-source-identity",
      });
    }
  });

  it("allows nested KiCad Reference property metadata without extra scalar values", () => {
    const withMetadata = footprint(rId, "R1").replace(
      '(property "Reference" "R1")',
      '(property "Reference" "R1" (at 1 2 90) (effects (font (size 1 1))))',
    );
    const result = verifiedPcbFootprintInventory(board(withMetadata));
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.footprints[0]?.reference).toBe("R1");
  });

  it("rejects hostile long numeric atoms ending in an invalid character", () => {
    expect(verifiedPcbFootprintInventory(board(footprint(rId, "R1", `${"1".repeat(16_384)}x 2`)))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
  });

  it("rejects ambiguous duplicate Reference properties", () => {
    const duplicated = footprint(rId, "R1").replace(
      '(property "Reference" "R1")',
      '(property "Reference" "R1") (property "Reference" "R2")',
    );
    expect(verifiedPcbFootprintInventory(board(duplicated))).toEqual({
      status: "unavailable",
      reason: "missing-source-identity",
    });
  });

  it("reports oversize source as unavailable rather than throwing", () => {
    expect(verifiedPcbFootprintInventory("x".repeat(MAX_KICAD_TEXT_BYTES + 1))).toEqual({
      status: "unavailable",
      reason: "malformed-source",
    });
  });

  it("rejects 10,001 valid footprints before returning partial results", () => {
    const parts = Array.from({ length: 10_001 }, (_, index) =>
      footprint(`bf7f5122-bc89-413e-aa3e-${index.toString(16).padStart(12, "0")}`, `R${index}`),
    );
    expect(verifiedPcbFootprintInventory(board(...parts))).toEqual({
      status: "unavailable",
      reason: "too-many-footprints",
    });
  });
  it("returns a complete but empty footprint inventory for a valid board with none", () => {
    const result = verifiedPcbFootprintInventory(board());
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.footprints).toEqual([]);
  });
});
