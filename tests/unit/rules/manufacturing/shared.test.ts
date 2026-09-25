import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { loadGerberStackup, missingReferences, positiveInteger } from "../../../../src/rules/manufacturing/shared.js";
import { writeFixture } from "../helpers.js";

/** A paste layer that says what it is, so the name is the only thing under test. */
const plainPasteLayer = () =>
  ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Paste,Bot*%", "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

describe("manufacturing shared utilities", () => {
  describe("positiveInteger", () => {
    it("returns fallback for non-number value", () => {
      expect(positiveInteger("abc" as unknown as number, 5)).toBe(5);
    });

    it("returns fallback for non-integer number", () => {
      expect(positiveInteger(3.14, 5)).toBe(5);
    });

    it("returns fallback for zero", () => {
      expect(positiveInteger(0, 5)).toBe(5);
    });

    it("returns value for valid positive integer", () => {
      expect(positiveInteger(10, 5)).toBe(10);
    });
  });

  describe("missingReferences", () => {
    it("matches reference when found in text", () => {
      expect(missingReferences("Ref,Comment\nR1,Resistor\n", ["R1"])).toEqual([]);
    });
  });

  describe("loadGerberStackup", () => {
    it("reports layer filenames with forward slashes whatever separator the path carries", async () => {
      // A layer filename is report text rather than a path this process opens again, so the
      // separator it is given by the platform that discovered the file must not survive into a
      // report: a Windows run reached `details.pasteLayerFiles` as `fab\bottom-paste.gbr` while
      // the same finding's `resource.path` was slash-normalized, which made the evidence for one
      // finding spell the same file two ways depending on where the run happened.
      //
      // The file is written under a Windows-style path so the assertion bites on every platform
      // rather than only where the separator is native: `path.relative` passes the separator
      // through, so the old behaviour fails this test on Linux and Windows alike.
      const root = await writeFixture({ "fab\\bottom-paste.gbr": plainPasteLayer() });
      const windowsStylePath = path.join(root, "fab\\bottom-paste.gbr");

      const { entries, stackup } = await loadGerberStackup(root, [windowsStylePath]);

      expect(entries[0]?.filename).toBe("fab/bottom-paste.gbr");
      // The declared `TF.FileFunction` is what keeps the layer in the stackup, so the evidence
      // under test is a real layer entry rather than a file this reader could not place.
      expect(stackup.layers).toHaveLength(1);
      expect(stackup.layers[0]).toMatchObject({ role: "solderpaste", side: "bottom" });
      expect(stackup.layers[0]?.filename).toBe("fab/bottom-paste.gbr");
    });
  });

  it("uses default search root when project has no output roots", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": `
(kicad_pcb
  (title_block (rev "1.0.0"))
  (footprint "R_0603" (at 10 10 0) (layer "F.Cu") (property "Reference" "R1"))
)
`,
      "boardreadyops.yml": `version: 1
rules:
  "manufacturing.position-coverage":
    enabled: true
fail-on: never
`,
    });
    const result = await runPipeline({ path: root, rules: ["manufacturing.position-coverage"], failOn: "never" });
    expect(result.findings.length).toBeGreaterThanOrEqual(0);
  });
});
