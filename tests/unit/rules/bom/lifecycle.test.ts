import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { writeFixture } from "../helpers.js";

describe("bom.lifecycle", () => {
  it("flags EOL lifecycle statuses from a local BOM", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle\nU1,MCU-1,EOL\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings[0]?.severity).toBe("high");
    expect(result.findings[0]?.details).toMatchObject({ reference: "U1", lifecycle: "EOL" });
  });

  it("uses configured lifecycle databases and severity overrides", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\nU2,MCU-2\n",
      "lifecycle.json": JSON.stringify({ "MCU-1": "NRND", "MCU-2": "Active", ignored: 12 }),
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.lifecycle:
    db: lifecycle.json
    severity: low
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "bom.lifecycle",
      severity: "low",
      details: { reference: "U1", mpn: "MCU-1", lifecycle: "NRND" },
    });
  });

  it("honors configured severity for EOL statuses", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle\nU1,MCU-1,EOL\n",
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.lifecycle:
    severity: medium
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings[0]?.severity).toBe("medium");
  });

  it("ignores unreadable lifecycle database files", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\n",
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.lifecycle:
    db: missing.json
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings).toEqual([]);
  });

  it("ignores DNP BOM rows with risky lifecycle statuses", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle,DNP\nU1,MCU-1,EOL,yes\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings).toEqual([]);
  });

  it("does not duplicate populated BOM lifecycle statuses covered by eol detection", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle\nU1,MCU-1,EOL\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({
      path: root,
      rules: ["bom.eol-detection", "bom.lifecycle"],
      failOn: "never",
    });

    expect(result.findings.map((finding) => finding.ruleId)).toEqual(["bom.eol-detection"]);
  });

  it("flags discontinued, preview, and not-recommended lifecycle statuses from a local BOM", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle\nU1,MCU-1,discontinued\nU2,MCU-2,preview\nU3,MCU-3,not recommended\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]?.details).toMatchObject({ reference: "U1", lifecycle: "discontinued" });
    expect(result.findings[0]?.severity).toBe("high");
    expect(result.findings[1]?.details).toMatchObject({ reference: "U2", lifecycle: "preview" });
    expect(result.findings[1]?.severity).toBe("medium");
    expect(result.findings[2]?.details).toMatchObject({ reference: "U3", lifecycle: "not recommended" });
  });

  it("falls back to schematic components when no BOM file is configured", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": `(kicad_sch
        (symbol
          (property "Reference" "U1")
          (property "Value" "MCU")
          (property "Manufacturer Part Number" "MCU-NRND")
        )
      )`,
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "lifecycle.json": JSON.stringify({ "MCU-NRND": "NRND" }),
      "boardreadyops.yml": `version: 1
rules:
  bom.lifecycle:
    db: lifecycle.json
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.ruleId).toBe("bom.lifecycle");
  });

  it("ignores non-string entries in the lifecycle database", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\nU2,MCU-2\n",
      "lifecycle.json": JSON.stringify({ "MCU-1": "EOL", "MCU-2": 42 }),
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.lifecycle:
    db: lifecycle.json
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.details).toMatchObject({ reference: "U1", mpn: "MCU-1" });
  });
});
