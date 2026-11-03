import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_KICAD_TEXT_BYTES } from "../../../src/kicad/project-model.js";
import { parseSchematic } from "../../../src/kicad/schematic.js";
import { HostileInputError } from "../../../src/util/errors.js";
import { writeFixture } from "../rules/helpers.js";

describe("parseSchematic hostile input guard", () => {
  it("preserves BOM-excluded symbols in the general schematic model", async () => {
    const dir = await writeFixture({
      "source.kicad_sch":
        '(kicad_sch (symbol (in_bom no) (property "Reference" "#PWR01")) (symbol (in_bom no) (property "Reference" "FID1")) (symbol (in_bom yes) (property "Reference" "U1")) (symbol (property "Reference" "R1")))',
    });
    const parsed = await parseSchematic(path.join(dir, "source.kicad_sch"));
    expect(parsed.components.map((component) => [component.reference, component.inBom])).toEqual([
      ["#PWR01", false],
      ["FID1", false],
      ["U1", undefined],
      ["R1", undefined],
    ]);
  });

  it("rejects an oversized .kicad_sch file instead of parsing it", async () => {
    const dir = await writeFixture({
      "oversized.kicad_sch": `(kicad_sch ${"a".repeat(MAX_KICAD_TEXT_BYTES + 1)})`,
    });
    await expect(parseSchematic(`${dir}/oversized.kicad_sch`)).rejects.toThrow(HostileInputError);
  });
});
