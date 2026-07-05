import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

const boardWithCustomPolarized = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "custom_led" (layer "F.Cu") (property "Reference" "LED1"))
  (footprint "custom_diode" (layer "F.Cu") (property "Reference" "D1"))
)
`;

const boardWithLibraryPolarized = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "Diode_SMD:D_SOD-123" (layer "F.Cu") (property "Reference" "D1"))
  (footprint "LED_SMD:LED_0603_1608Metric" (layer "F.Cu") (property "Reference" "LED1"))
  (footprint "Capacitor_THT:CP_Radial_D5.0mm_P2.00mm" (layer "F.Cu") (property "Reference" "C1"))
)
`;

const enabledConfig = `version: 1
rules:
  manufacturing.dfm-polarity-markers:
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
  manufacturing.dfm-polarity-markers:
    enabled: false
fail-on: never
`;

describe("manufacturing.dfm-polarity-markers", () => {
  it("does not fire when not explicitly enabled", async () => {
    const root = await fixture(boardWithCustomPolarized, "version: 1\nfail-on: never\n");
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-polarity-markers", 0);
  });

  it("does not fire when explicitly disabled", async () => {
    const root = await fixture(boardWithCustomPolarized, disabledConfig);
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-polarity-markers", 0);
  });

  it("flags custom-footprint LEDs and diodes when enabled", async () => {
    const root = await fixture(boardWithCustomPolarized, enabledConfig);
    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" }),
      "manufacturing.dfm-polarity-markers",
      2,
    );
    const refs = findings.map((f) => f.details?.reference).sort();
    expect(refs).toEqual(["D1", "LED1"]);
  });

  it("does not flag standard library polarized footprints", async () => {
    const root = await fixture(boardWithLibraryPolarized, enabledConfig);
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-polarity-markers", 0);
  });

  it("flags custom electrolytic capacitors", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        (footprint "CP_ELECTRO_100uF" (layer "F.Cu") (property "Reference" "C1"))
        (footprint "capacitor_tht:cp_radial" (layer "F.Cu") (property "Reference" "C2"))
      )`,
      enabledConfig,
    );
    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" }),
      "manufacturing.dfm-polarity-markers",
      1,
    );
    expect(findings[0]?.details).toMatchObject({ reference: "C1" });
  });

  it("ignores DNP and board-only polarized components", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        (footprint "custom_led" (layer "F.Cu") (property "Reference" "LED1") (attr dnp))
        (footprint "custom_diode" (layer "F.Cu") (property "Reference" "D1") (attr board_only))
      )`,
      enabledConfig,
    );
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-polarity-markers", 0);
  });

  it("does not flag resistors and non-polarized components", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        (footprint "custom_res" (layer "F.Cu") (property "Reference" "R1"))
        (footprint "custom_ic" (layer "F.Cu") (property "Reference" "U1"))
      )`,
      enabledConfig,
    );
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-polarity-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-polarity-markers", 0);
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
