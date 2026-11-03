import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, runFixture, writeFixture } from "../helpers.js";

describe("bom.missing-mpn", () => {
  it("flags populated BOM rows without manufacturer part numbers", async () => {
    const result = await runFixture("bom-missing-mpn");
    const findings = expectRule(result, "bom.missing-mpn", 1);
    expect(findings[0]?.details).toMatchObject({ reference: "R1" });
  });

  it("does not request MPNs for schematic symbols excluded from BOM exports", async () => {
    const dir = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch":
        '(kicad_sch (symbol (lib_id "power:GND") (in_bom no) (on_board no) (property "Reference" "#PWR01")) (symbol (lib_id "Mechanical:Fiducial") (in_bom no) (property "Reference" "FID1")) (symbol (lib_id "Device:R") (in_bom yes) (property "Reference" "R1")) (symbol (lib_id "Device:C") (property "Reference" "C1")) (symbol (lib_id "Device:U") (in_bom yes) (property "Reference" "U1") (property "MPN" "ABC123")) (symbol (lib_id "Device:R") (property "Reference" "R2") (property "DNP" "true")))',
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
    });
    const result = await runPipeline({ path: dir, rules: ["bom.missing-mpn"], failOn: "never" });
    const findings = expectRule(result, "bom.missing-mpn", 2);
    expect(findings.map((item) => item.details?.reference).sort()).toEqual(["C1", "R1"]);
  });

  it("never treats KiCad virtual # references as purchasable schematic parts when exclusion flags are absent", async () => {
    const dir = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch":
        '(kicad_sch (symbol (lib_id "power:VCC") (property "Reference" "#PWR010")) (symbol (lib_id "power:PWR_FLAG") (in_bom yes) (property "Reference" "#FLG01")) (symbol (lib_id "Graphic:OSHW") (property "Reference" "#SYM01")) (symbol (lib_id "Device:R") (property "Reference" "R1")))',
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
    });
    const result = await runPipeline({ path: dir, rules: ["bom.missing-mpn"], failOn: "never" });
    const findings = expectRule(result, "bom.missing-mpn", 1);
    expect(findings.map((item) => item.details?.reference)).toEqual(["R1"]);
  });

  it("reports virtual references explicitly present in an external BOM as export errors, not missing purchasable MPNs", async () => {
    const dir = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "manual.csv": "Reference,MPN\n#PWR010,\nR1,\n",
    });
    const result = await runPipeline({
      path: dir,
      bom: "manual.csv",
      rules: ["bom.missing-mpn"],
      failOn: "never",
    });
    const findings = expectRule(result, "bom.missing-mpn", 2);
    const power = findings.find((item) => item.details?.reference === "#PWR010");
    const resistor = findings.find((item) => item.details?.reference === "R1");
    expect(power?.message).toContain("Exclude it from the exported BOM");
    expect(power?.message).not.toContain("missing an MPN");
    expect(resistor?.message).toBe("R1 is missing an MPN.");
  });

  it("continues to honor explicit BOM input even for a schematic-excluded reference", async () => {
    const dir = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": '(kicad_sch (symbol (in_bom no) (property "Reference" "#PWR01")))',
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "manual.csv": "Reference,MPN\n#PWR01,\n",
    });
    const result = await runPipeline({
      path: dir,
      bom: "manual.csv",
      rules: ["bom.missing-mpn"],
      failOn: "never",
    });
    expect(expectRule(result, "bom.missing-mpn", 1)[0]?.details).toMatchObject({ reference: "#PWR01" });
  });

  it("uses explicit BOM options and schematic fallback rows", async () => {
    const explicitBom = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "manual.csv": "Reference,MPN\nR1,\nR2,ABC\n",
    });
    const explicit = await runPipeline({
      path: explicitBom,
      bom: "manual.csv",
      rules: ["bom.missing-mpn"],
      failOn: "never",
    });
    expectRule(explicit, "bom.missing-mpn", 1);

    const schematicOnly = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": `(kicad_sch
        (symbol
          (property "Reference" "U1")
          (property "Value" "MCU")
          (property "Footprint" "Package:QFN")
        )
      )`,
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
    });
    const fallback = await runPipeline({ path: schematicOnly, rules: ["bom.missing-mpn"], failOn: "never" });
    const findings = expectRule(fallback, "bom.missing-mpn", 1);
    expect(findings[0]?.resource.kind).toBe("schematic");
  });
});
