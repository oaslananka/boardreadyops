import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

/**
 * A fabricator will build a board whose mask set is short a side, and the result is exposed copper
 * across that whole face. `manufacturing.outputs-present` checks that a Gerber set exists by
 * filename pattern; it never opens a file, so it cannot tell whether the set is complete. Part of
 * #770.
 */

const enabled = "version: 1\nrules:\n  manufacturing.mask-coverage:\n    enabled: true\nfail-on: never\n";

const header = ["%FSLAX36Y36*%", "%MOMM*%"];
const layer = (fileFunction: string) =>
  [...header, `%TF.FileFunction,${fileFunction}*%`, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");
const plainLayer = [...header, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

async function run(files: Record<string, string>) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": '(kicad_pcb (footprint "Lib:R" (layer "F.Cu") (at 1 1) (property "Reference" "R1")))',
    "boardreadyops.yml": enabled,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.mask-coverage"], failOn: "never" });
}

describe("manufacturing.mask-coverage", () => {
  it("flags a side that has copper and no mask", async () => {
    const result = await run({
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
    });

    const findings = expectRule(result, "manufacturing.mask-coverage", 1);
    expect(findings[0]?.message).toContain("bottom copper but no bottom solder mask");
    expect(findings[0]?.details).toMatchObject({ side: "bottom", copperLayers: 2, maskLayers: 1 });
  });

  it("stays quiet when both sides are covered", async () => {
    const result = await run({
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    expect(expectRule(result, "manufacturing.mask-coverage", 0)).toEqual([]);
  });

  it("does not ask for a mask on an inner layer", async () => {
    const result = await run({
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/in1.gbr": layer("Copper,L2,Inr"),
      "fab/in2.gbr": layer("Copper,L3,Inr"),
      "fab/bottom-copper.gbr": layer("Copper,L4,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    // Mask applies to the outer faces. Requiring one per copper layer would raise a finding on
    // every four-layer board in existence.
    expect(expectRule(result, "manufacturing.mask-coverage", 0)).toEqual([]);
  });

  it("flags both sides when the package has no mask at all", async () => {
    const result = await run({
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
    });

    const findings = expectRule(result, "manufacturing.mask-coverage", 2);
    expect(findings.map((entry) => entry.details?.side).sort()).toEqual(["bottom", "top"]);
  });

  it("reads a package that declares nothing, by filename", async () => {
    const result = await run({
      "fab/board.gtl": plainLayer,
      "fab/board.gbl": plainLayer,
      "fab/board.gts": plainLayer,
    });

    // Pre-X2 output says nothing about itself, so the extensions are all there is. The bottom mask
    // is genuinely absent here, and the rule still finds it.
    const findings = expectRule(result, "manufacturing.mask-coverage", 1);
    expect(findings[0]?.details).toMatchObject({ side: "bottom" });
  });

  it("believes a file's declaration over its extension", async () => {
    const result = await run({
      "fab/board.gtl": layer("Copper,L1,Top"),
      // Named as a bottom copper layer, declares itself the bottom mask.
      "fab/board.gbl": layer("Soldermask,Bot"),
      "fab/board.gts": layer("Soldermask,Top"),
    });

    // There is no bottom copper once the file is read, so nothing is missing a mask -- the
    // filename reading alone would have reported bottom copper with no bottom mask.
    expect(expectRule(result, "manufacturing.mask-coverage", 0)).toEqual([]);
  });

  it("stays quiet when there is no Gerber package to inspect", async () => {
    const result = await run({});

    // Whether a package should exist at all belongs to manufacturing.outputs-present. Raising it
    // here as well would report one problem twice.
    expect(expectRule(result, "manufacturing.mask-coverage", 0)).toEqual([]);
  });

  it("warns rather than blocks at the default threshold", async () => {
    const result = await run({
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
    });

    // Layer roles can still come from a filename, and the normalizer does not yet say which per
    // layer. Blocking on a classification that may have come from a name is what turns a gate off.
    for (const entry of expectRule(result, "manufacturing.mask-coverage", 2)) {
      expect(entry.severity).toBe("medium");
    }
  });
});
