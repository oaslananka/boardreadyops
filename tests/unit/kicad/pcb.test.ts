import { describe, expect, it } from "vitest";
import { parsePcb } from "../../../src/kicad/pcb.js";
import { MAX_KICAD_TEXT_BYTES } from "../../../src/kicad/project-model.js";
import { HostileInputError } from "../../../src/util/errors.js";
import { writeFixture } from "../rules/helpers.js";

describe("parsePcb hostile input guard", () => {
  it("rejects an oversized .kicad_pcb file instead of parsing it", async () => {
    const dir = await writeFixture({
      "oversized.kicad_pcb": `(kicad_pcb ${"a".repeat(MAX_KICAD_TEXT_BYTES + 1)})`,
    });
    await expect(parsePcb(`${dir}/oversized.kicad_pcb`)).rejects.toThrow(HostileInputError);
  });
});
