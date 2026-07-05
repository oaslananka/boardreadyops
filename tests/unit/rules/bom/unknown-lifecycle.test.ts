import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { writeFixture } from "../helpers.js";

describe("bom.unknown-lifecycle", () => {
  it("flags BOM components with no lifecycle field and no database entry", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\nU2,MCU-2\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.ruleId).toBe("bom.unknown-lifecycle");
    expect(result.findings[0]?.severity).toBe("info");
    expect(result.findings[0]?.details).toMatchObject({ reference: "U1", mpn: "MCU-1" });
  });

  it("does not flag components that have a lifecycle field", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,Lifecycle\nU1,MCU-1,Active\nU2,MCU-2,NRND\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(0);
  });

  it("does not flag components covered by a lifecycle database", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\nU2,MCU-2\n",
      "lifecycle.json": JSON.stringify({ "MCU-1": "Active", "MCU-2": "NRND" }),
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.unknown-lifecycle:
    db: lifecycle.json
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(0);
  });

  it("only flags components not in the database when some are covered", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN\nU1,MCU-1\nU2,MCU-2\n",
      "lifecycle.json": JSON.stringify({ "MCU-1": "Active" }),
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: bom.csv
rules:
  bom.unknown-lifecycle:
    db: lifecycle.json
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.details).toMatchObject({ reference: "U2", mpn: "MCU-2" });
  });

  it("ignores DNP rows", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bom.csv": "Reference,MPN,DNP\nU1,MCU-1,yes\n",
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\n    bom: bom.csv\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(0);
  });

  it("respects severity configuration", async () => {
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
  bom.unknown-lifecycle:
    severity: low
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings[0]?.severity).toBe("low");
  });

  it("produces no findings when BOM is empty", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "boardreadyops.yml": "version: 1\nprojects:\n  - path: .\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["bom.unknown-lifecycle"], failOn: "never" });

    expect(result.findings).toHaveLength(0);
  });
});
