import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, runFixture, writeFixture } from "../helpers.js";

describe("bom.footprint-mismatch", () => {
  it("flags BOM footprint strings that differ from the PCB footprint", async () => {
    const result = await runFixture("bom-footprint-mismatch");
    const findings = expectRule(result, "bom.footprint-mismatch", 1);
    expect(findings[0]?.details).toMatchObject({
      reference: "R1",
      bom: "Resistor_SMD:R_0603",
      pcb: "Resistor_SMD:R_0805",
    });
    expect(findings[0]?.message).toBe(
      "R1 BOM footprint Resistor_SMD:R_0603 does not match PCB footprint Resistor_SMD:R_0805.",
    );
  });

  it("reports an unassigned PCB footprint without a misleading blank comparison", async () => {
    const root = await writeFixture({
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
      "board.kicad_pro": "{}",
      "board.kicad_pcb":
        '(kicad_pcb (version 20250114) (title_block (rev "1.0.0")) (footprint "" (property "Reference" "R1")))',
      "bom.csv": "Reference,Value,Footprint\nR1,10k,Resistor_SMD:R_0603\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["bom.footprint-mismatch"],
      failOn: "never",
    });
    const findings = expectRule(result, "bom.footprint-mismatch", 1);
    expect(findings[0]?.message).toBe(
      "R1 BOM footprint Resistor_SMD:R_0603 cannot be compared: the PCB footprint assignment is missing.",
    );
    expect(findings[0]?.details).toMatchObject({ reference: "R1", bom: "Resistor_SMD:R_0603", pcb: "" });
  });
});
