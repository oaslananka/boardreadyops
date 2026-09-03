import { describe, expect, it } from "vitest";
import { MAX_KICAD_TEXT_BYTES } from "../../../src/kicad/project-model.js";
import { parseSchematic } from "../../../src/kicad/schematic.js";
import { HostileInputError } from "../../../src/util/errors.js";
import { writeFixture } from "../rules/helpers.js";

describe("parseSchematic hostile input guard", () => {
  it("rejects an oversized .kicad_sch file instead of parsing it", async () => {
    const dir = await writeFixture({
      "oversized.kicad_sch": `(kicad_sch ${"a".repeat(MAX_KICAD_TEXT_BYTES + 1)})`,
    });
    await expect(parseSchematic(`${dir}/oversized.kicad_sch`)).rejects.toThrow(HostileInputError);
  });
});
