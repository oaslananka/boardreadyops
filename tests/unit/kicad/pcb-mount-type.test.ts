import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePcb } from "../../../src/kicad/pcb.js";
import { writeFixture } from "../rules/helpers.js";

const fixtureRoot = path.resolve("tests/fixtures/kicad/mount-types");

const padFixtures = [
  { file: "surface-mount.kicad_pcb", mountType: "smd" },
  { file: "through-hole.kicad_pcb", mountType: "through_hole" },
  { file: "mixed.kicad_pcb", mountType: "smd" },
] as const;

describe("parsePcb footprint mount type", () => {
  it.each(padFixtures)("derives $mountType from $file", async ({ file, mountType }) => {
    const pcb = await parsePcb(path.join(fixtureRoot, file));

    expect(pcb.footprints).toHaveLength(1);
    expect(pcb.footprints[0]?.mountType).toBe(mountType);
  });

  it("uses footprint attributes only when pads do not provide a type", async () => {
    const root = await writeFixture({
      "board.kicad_pcb": `(kicad_pcb
        (footprint "Lib:SMD" (property "Reference" "R1") (attr smd))
        (footprint "Lib:THT" (property "Reference" "J1") (attr through_hole))
        (footprint "Lib:Virtual" (property "Reference" "V1") (attr virtual))
        (footprint "Lib:Unknown" (property "Reference" "X1"))
        (footprint "Lib:PadSmd" (property "Reference" "U1") (attr through_hole)
          (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))
        (footprint "Lib:PadThru" (property "Reference" "U2") (attr smd)
          (pad "1" np_thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu")))
      )`,
    });

    const pcb = await parsePcb(`${root}/board.kicad_pcb`);

    expect(pcb.footprints.map((footprint) => footprint.mountType)).toEqual([
      "smd",
      "through_hole",
      "virtual",
      "unknown",
      "smd",
      "through_hole",
    ]);
  });
});
