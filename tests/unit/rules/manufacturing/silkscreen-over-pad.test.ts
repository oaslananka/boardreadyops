import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

const boardWithManySmd = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R1"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R2"))
  (footprint "Capacitor_SMD:C_0603" (layer "F.Cu") (property "Reference" "C1"))
  (footprint "Capacitor_SMD:C_0603" (layer "F.Cu") (property "Reference" "C2"))
  (footprint "Package_SO:SOIC-8" (layer "F.Cu") (property "Reference" "U1"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R3"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R4"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R5"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R6"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R7"))
)
`;

const boardWithFewSmd = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (property "Reference" "R1"))
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (property "Reference" "R2"))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x10" (layer "F.Cu") (property "Reference" "J1"))
)
`;

const enabledConfig = `version: 1
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: true
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
fail-on: never
`;

const disabledConfig = `version: 1
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: false
fail-on: never
`;

describe("manufacturing.dfm-silkscreen-over-pad", () => {
  it("does not fire when not explicitly enabled", async () => {
    const root = await fixture(boardWithManySmd, "version: 1\nfail-on: never\n");
    const result = await runPipeline({
      path: root,
      rules: ["manufacturing.dfm-silkscreen-over-pad"],
      failOn: "never",
    });
    expectRule(result, "manufacturing.dfm-silkscreen-over-pad", 0);
  });

  it("does not fire when explicitly disabled", async () => {
    const root = await fixture(boardWithManySmd, disabledConfig);
    const result = await runPipeline({
      path: root,
      rules: ["manufacturing.dfm-silkscreen-over-pad"],
      failOn: "never",
    });
    expectRule(result, "manufacturing.dfm-silkscreen-over-pad", 0);
  });

  it("flags dense SMD boards at or above the default threshold", async () => {
    const root = await fixture(boardWithManySmd, enabledConfig);
    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.dfm-silkscreen-over-pad"], failOn: "never" }),
      "manufacturing.dfm-silkscreen-over-pad",
      1,
    );
    expect(findings[0]?.details).toMatchObject({ smdCount: 10, minimumSmdCount: 10 });
  });

  it("does not flag sparse boards below the threshold", async () => {
    const root = await fixture(boardWithFewSmd, enabledConfig);
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-silkscreen-over-pad"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-silkscreen-over-pad", 0);
  });

  it("respects custom minimum-smd-count configuration", async () => {
    const customConfig = `version: 1
rules:
  manufacturing.dfm-silkscreen-over-pad:
    enabled: true
    minimum-smd-count: 2
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
fail-on: never
`;
    const root = await fixture(boardWithFewSmd, customConfig);
    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.dfm-silkscreen-over-pad"], failOn: "never" }),
      "manufacturing.dfm-silkscreen-over-pad",
      1,
    );
    expect(findings[0]?.details).toMatchObject({ minimumSmdCount: 2 });
  });

  it("does not flag DNP components", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        ${Array.from({ length: 12 }, (_, i) => `(footprint "Resistor_SMD:R_0402" (layer "F.Cu") (property "Reference" "R${i + 1}") (attr dnp))`).join("\n")}
      )`,
      enabledConfig,
    );
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-silkscreen-over-pad"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-silkscreen-over-pad", 0);
  });
});

async function fixture(board: string, config: string): Promise<string> {
  return writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": board,
    "boardreadyops.yml": config,
  });
}
