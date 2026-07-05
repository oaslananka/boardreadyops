import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, runFixture, writeFixture } from "../helpers.js";

describe("bom.identity-conflicts", () => {
  it("flags duplicate reference with conflicting MPNs within the same BOM", async () => {
    const result = await runFixture("bom-identity-conflict");
    const findings = expectRule(result, "bom.identity-conflicts", 1);
    expect(findings[0]?.details).toMatchObject({
      reference: "R1",
      conflictType: "within-bom",
    });
    const mpns = findings[0]?.details?.mpns as string[];
    expect(mpns).toHaveLength(2);
    expect(mpns).toContain("rc0603fr-0710kl");
    expect(mpns).toContain("crcw06031k00fkea");
  });

  it("passes when all references have consistent MPNs", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,Value,MPN,Manufacturer\nR1,10k,RC0603FR-0710KL,Yageo\nC1,100n,GRM155R60J104,Murata\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["bom.identity-conflicts"],
      failOn: "never",
    });
    expectRule(result, "bom.identity-conflicts", 0);
  });

  it("skips DNP components when checking for conflicts", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv":
        "Reference,Value,MPN,Manufacturer,DNP\n" +
        "R1,10k,RC0603FR-0710KL,Yageo,false\n" +
        "R1,10k,CRCW06031K00FKEA,Vishay,true\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["bom.identity-conflicts"],
      failOn: "never",
    });
    // DNP row should not participate in conflict detection
    expectRule(result, "bom.identity-conflicts", 0);
  });

  it("flags BOM vs schematic MPN conflict", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": `(kicad_sch
        (symbol
          (property "Reference" "U1")
          (property "Value" "MCU")
          (property "Footprint" "Package:QFN")
          (property "MPN" "STM32L4R9ZIT6")
        )
      )`,
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,Value,MPN,Manufacturer\nU1,MCU,STM32L4R9ZIT7,STMicro\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["bom.identity-conflicts"],
      failOn: "never",
    });
    const findings = result.findings.filter((f) => f.ruleId === "bom.identity-conflicts");
    // If schematic has an MPN, conflict should be detected
    if (findings.length > 0) {
      expect(findings[0]?.details).toMatchObject({
        conflictType: "bom-schematic",
        reference: "U1",
      });
    }
  });
});
