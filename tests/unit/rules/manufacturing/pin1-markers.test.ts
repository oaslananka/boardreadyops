import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

const boardWithCustomIc = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "custom_ic" (layer "F.Cu") (property "Reference" "U1"))
  (footprint "custom_connector" (layer "F.Cu") (property "Reference" "J1"))
)
`;

const boardWithLibraryIc = `
(kicad_pcb
  (title_block (rev "v1.0"))
  (footprint "Package_SOIC:SOIC-8_3.9x4.9mm_P1.27mm" (layer "F.Cu") (property "Reference" "U1"))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x10_P2.54mm_Vertical" (layer "F.Cu") (property "Reference" "J1"))
)
`;

const enabledConfig = `version: 1
rules:
  manufacturing.dfm-pin1-markers:
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
  manufacturing.dfm-pin1-markers:
    enabled: false
fail-on: never
`;

describe("manufacturing.dfm-pin1-markers", () => {
  it("does not fire when not explicitly enabled", async () => {
    const root = await fixture(boardWithCustomIc, "version: 1\nfail-on: never\n");
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-pin1-markers", 0);
  });

  it("does not fire when explicitly disabled", async () => {
    const root = await fixture(boardWithCustomIc, disabledConfig);
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-pin1-markers", 0);
  });

  it("flags custom-footprint ICs and connectors when enabled", async () => {
    const root = await fixture(boardWithCustomIc, enabledConfig);
    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" }),
      "manufacturing.dfm-pin1-markers",
      2,
    );
    expect(findings[0]?.details).toMatchObject({ reference: "J1" });
    expect(findings[1]?.details).toMatchObject({ reference: "U1" });
  });

  it("does not flag standard library footprint ICs and connectors", async () => {
    const root = await fixture(boardWithLibraryIc, enabledConfig);
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-pin1-markers", 0);
  });

  it("ignores DNP and board-only components", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        (footprint "custom_ic" (layer "F.Cu") (property "Reference" "U1") (attr dnp))
        (footprint "custom_ic" (layer "F.Cu") (property "Reference" "U2") (attr board_only))
      )`,
      enabledConfig,
    );
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-pin1-markers", 0);
  });

  it("does not flag resistors and capacitors", async () => {
    const root = await fixture(
      `(kicad_pcb (title_block (rev "v1.0"))
        (footprint "custom_res" (layer "F.Cu") (property "Reference" "R1"))
        (footprint "custom_cap" (layer "F.Cu") (property "Reference" "C1"))
      )`,
      enabledConfig,
    );
    const result = await runPipeline({ path: root, rules: ["manufacturing.dfm-pin1-markers"], failOn: "never" });
    expectRule(result, "manufacturing.dfm-pin1-markers", 0);
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
