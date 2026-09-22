import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

const enabled = "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: true\nfail-on: never\n";

const header = ["%FSLAX36Y36*%", "%MOMM*%"];
const layer = (fileFunction: string) =>
  [...header, `%TF.FileFunction,${fileFunction}*%`, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");
const plainLayer = [...header, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

async function run(pcbContent: string, files: Record<string, string>, configText = enabled) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": pcbContent,
    "boardreadyops.yml": configText,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.paste-coverage"], failOn: "never" });
}

describe("manufacturing.paste-coverage", () => {
  it("flags a side with SMT components that lacks a solder paste layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.message).toContain("top side, but the Gerber package lacks a top solder paste");
    expect(findings[0]?.details).toMatchObject({ side: "top", pasteLayers: 0 });
    expect(findings[0]?.fix?.description).toContain("Export the top solder paste layer (F.Paste)");
    expect(findings[0]?.fix?.steps).toHaveLength(3);
    expect(findings[0]?.fix?.steps?.[0]).toContain("In KiCad, open File > Fabrication Outputs > Gerbers.");
  });

  it("flags bottom-side SMT assembly missing bottom paste layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "B.Cu") (at 1 1) (attr smd) (property "Reference" "R2")))`;
    const result = await run(pcb, {
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.message).toContain("bottom side, but the Gerber package lacks a bottom solder paste");
    expect(findings[0]?.details).toMatchObject({ side: "bottom", pasteLayers: 0 });
    expect(findings[0]?.fix?.description).toContain("Export the bottom solder paste layer (B.Paste)");
  });

  it("passes when SMT side has matching paste stencil layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/top-paste.gbr": layer("Paste,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("does not require paste for DNP footprints", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd dnp) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("does not require paste for through-hole-only components", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:Resistor_THT" (layer "F.Cu") (at 1 1) (attr through_hole) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("requires paste for mixed assembly only on the side with SMT components", async () => {
    const pcb = `(kicad_pcb
      (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1"))
      (footprint "Lib:Header_THT" (layer "B.Cu") (at 5 5) (attr through_hole) (property "Reference" "J1"))
    )`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.details).toMatchObject({ side: "top" });
  });

  it("reads plain Gerber filenames when metadata is missing", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/board.gtl": plainLayer,
      "fab/board.gts": plainLayer,
      "fab/board.gtp": plainLayer,
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("returns no findings when rule is disabled or no Gerbers exist", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const disabledConfig = "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: false\nfail-on: never\n";
    const disabledRes = await run(
      pcb,
      {
        "fab/top-copper.gbr": layer("Copper,L1,Top"),
      },
      disabledConfig,
    );
    expect(expectRule(disabledRes, "manufacturing.paste-coverage", 0)).toEqual([]);

    const noGerbersRes = await run(pcb, {});
    expect(expectRule(noGerbersRes, "manufacturing.paste-coverage", 0)).toEqual([]);
  });
});
