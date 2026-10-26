import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffVerifiedPcbFootprints } from "../../../src/kicad/footprint-diff.js";

const a = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const b = "c71b2196-ae56-4853-92ac-5497683704cd";
const c = "da57c9c2-65cc-45e7-a22f-f92c0cff0051";
function fp(
  id: string,
  reference: string,
  position = "1 2",
  layer = "F.Cu",
  libraryId = "Resistor_SMD:R_0603",
): string {
  return `(footprint "${libraryId}" (layer "${layer}") (at ${position}) (uuid "${id}") (property "Reference" "${reference}"))`;
}
function pcb(...footprints: string[]): string {
  return `(kicad_pcb (version 20250114) ${footprints.join(" ")})`;
}

describe("verified source-only PCB footprint changes", () => {
  it("detects same-UUID property and absolute physical position changes, retaining both source digests", () => {
    const base = pcb(fp(a, "R1", "10 20 90", "F.Cu", "Resistor_SMD:R_0603"));
    const head = pcb(fp(a, "R2", "11 20 180", "B.Cu", "Resistor_SMD:R_0805"));
    const delta = diffVerifiedPcbFootprints(base, head);
    expect(delta).toMatchObject({
      status: "complete",
      baseSourceSha256: createHash("sha256").update(base).digest("hex"),
      headSourceSha256: createHash("sha256").update(head).digest("hex"),
      changes: [
        {
          status: "footprint-modified",
          sourceUuid: a,
          changedFields: ["reference", "libraryId", "layer", "positionMm", "rotationDeg"],
          base: { positionMm: { x: 10, y: 20 } },
          head: { positionMm: { x: 11, y: 20 } },
        },
      ],
    });
  });

  it("reports added/removed footprints only when both full source inventories are valid", () => {
    const delta = diffVerifiedPcbFootprints(pcb(fp(b, "R1")), pcb(fp(c, "R1"), fp(a, "R2")));
    expect(delta.status).toBe("complete");
    if (delta.status !== "complete") return;
    expect(delta.changes.map((change) => [change.sourceUuid, change.status])).toEqual([
      [a, "footprint-added"],
      [b, "footprint-removed"],
      [c, "footprint-added"],
    ]);
  });

  it("does not report physical changes for layout order or decimal formatting alone", () => {
    const result = diffVerifiedPcbFootprints(
      pcb(fp(b, "R1", "1.000 2"), fp(a, "R2")),
      pcb(fp(a, "R2"), fp(b, "R1", "1 2.0")),
    );
    expect(result).toMatchObject({ status: "complete", changes: [] });
  });

  it("compares source coordinates from a checked-in native KiCad board fixture", () => {
    const base = readFileSync(
      new URL("../../fixtures/kicad/mount-types/surface-mount.kicad_pcb", import.meta.url),
      "utf8",
    );
    const head = base.replace("(at 100 100)", "(at 101 100)");
    expect(head).not.toBe(base);
    const delta = diffVerifiedPcbFootprints(base, head);
    expect(delta).toMatchObject({
      status: "complete",
      changes: [
        {
          sourceUuid: "11111111-1111-4111-8111-111111111111",
          status: "footprint-modified",
          changedFields: ["positionMm"],
          base: { positionMm: { x: 100, y: 100 } },
          head: { positionMm: { x: 101, y: 100 } },
        },
      ],
    });
  });

  it("fails closed if either native source lacks a complete verifiable inventory", () => {
    expect(diffVerifiedPcbFootprints(pcb(fp(a, "R1").replace(`(uuid "${a}")`, "")), pcb(fp(b, "R2")))).toEqual({
      status: "unavailable",
      side: "base",
      reason: "missing-source-identity",
    });
    expect(diffVerifiedPcbFootprints(pcb(fp(a, "R1")), pcb(fp(b, "R2"), fp(b, "R3")))).toEqual({
      status: "unavailable",
      side: "head",
      reason: "duplicate-uuid",
    });
  });

  it("keeps empty/unchanged boards complete without inventing an impact verdict", () => {
    expect(diffVerifiedPcbFootprints(pcb(), pcb())).toMatchObject({ status: "complete", changes: [] });
    expect(diffVerifiedPcbFootprints(pcb(fp(a, "R1")), pcb(fp(a, "R1")))).toMatchObject({
      status: "complete",
      changes: [],
    });
  });
});
