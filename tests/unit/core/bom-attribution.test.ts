import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../src/core/pipeline.js";
import { writeFixture } from "../rules/helpers.js";

const emptySchematic = "(kicad_sch)";
const emptyBoard = '(kicad_pcb (title_block (rev "")))';

describe("BOM attribution on the run result", () => {
  it("reports one BOM entry per discovered project, keyed by the project file", async () => {
    const root = await writeFixture({
      "hardware/main/main.kicad_pro": "{}",
      "hardware/main/main.kicad_sch": emptySchematic,
      "hardware/main/main.kicad_pcb": emptyBoard,
      "hardware/prototype/prototype.kicad_pro": "{}",
      "hardware/prototype/prototype.kicad_sch": emptySchematic,
      "hardware/prototype/prototype.kicad_pcb": emptyBoard,
    });

    const result = await runPipeline({
      path: root,
      rules: ["release.revision-set"],
      failOn: "never",
    });

    expect(result.boms?.map((bom) => bom.project)).toEqual([
      "hardware/main/main.kicad_pro",
      "hardware/prototype/prototype.kicad_pro",
    ]);
  });

  it("keeps a project with no resolvable BOM as an empty entry rather than omitting it", async () => {
    const root = await writeFixture({
      "hardware/main/main.kicad_pro": "{}",
      "hardware/main/main.kicad_sch": emptySchematic,
      "hardware/main/main.kicad_pcb": emptyBoard,
    });

    const result = await runPipeline({
      path: root,
      rules: ["release.revision-set"],
      failOn: "never",
    });

    expect(result.boms).toHaveLength(1);
    expect(result.boms?.[0]?.project).toBe("hardware/main/main.kicad_pro");
    expect(result.boms?.[0]?.components).toEqual([]);
  });

  it("keeps the run alive and the entry empty when the configured BOM path is unreadable", async () => {
    const root = await writeFixture({
      "main.kicad_pro": "{}",
      "main.kicad_sch": emptySchematic,
      "main.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "boardreadyops.yml": ["version: 1", "projects:", "  - path: .", "    bom: stale.csv", "fail-on: never"].join(
        "\n",
      ),
    });

    const result = await runPipeline({ path: root, rules: ["design.board-outline"], failOn: "never" });

    expect(result.boms).toHaveLength(1);
    expect(result.boms?.[0]?.components).toEqual([]);
  });

  it("honours a per-project BOM override so each board gets its own components", async () => {
    const root = await writeFixture({
      "hardware/main/main.kicad_pro": "{}",
      "hardware/main/main.kicad_sch": emptySchematic,
      "hardware/main/main.kicad_pcb": emptyBoard,
      "hardware/prototype/prototype.kicad_pro": "{}",
      "hardware/prototype/prototype.kicad_sch": emptySchematic,
      "hardware/prototype/prototype.kicad_pcb": emptyBoard,
      "boms/main.csv": ["Reference,MPN", "U1,MAIN-PART-1"].join("\n"),
      "boms/prototype.csv": ["Reference,MPN", "U9,PROTO-PART-9"].join("\n"),
      "boardreadyops.yml": [
        "version: 1",
        "projects:",
        "  - path: hardware/main",
        "    bom: boms/main.csv",
        "  - path: hardware/prototype",
        "    bom: boms/prototype.csv",
        "fail-on: never",
      ].join("\n"),
    });

    const result = await runPipeline({ path: root, rules: ["release.revision-set"], failOn: "never" });

    const byProject = new Map(result.boms?.map((bom) => [bom.project, bom.components]) ?? []);
    expect(byProject.get("hardware/main/main.kicad_pro")?.map((row) => row.mpn)).toEqual(["MAIN-PART-1"]);
    expect(byProject.get("hardware/prototype/prototype.kicad_pro")?.map((row) => row.mpn)).toEqual(["PROTO-PART-9"]);
  });

  it("carries the resolved component rows for a project that has a BOM", async () => {
    const root = await writeFixture({
      "hardware/main/main.kicad_pro": "{}",
      "hardware/main/main.kicad_sch": emptySchematic,
      "hardware/main/main.kicad_pcb": emptyBoard,
      "hardware/main/bom.csv": [
        "Reference,Value,MPN,Manufacturer,Quantity",
        "U1,STM32F103,STM32F103C8T6,ST,1",
        "R1,10k,RC0603FR-0710KL,Yageo,4",
      ].join("\n"),
    });

    const result = await runPipeline({
      path: root,
      rules: ["release.revision-set"],
      failOn: "never",
    });

    const components = result.boms?.[0]?.components ?? [];
    expect(components.map((component) => component.reference)).toEqual(["U1", "R1"]);
    expect(components[0]?.mpn).toBe("STM32F103C8T6");
  });

  it("does not lend one board's BOM to a sibling board that has none", async () => {
    const root = await writeFixture({
      "hardware/mainboard/mainboard.kicad_pro": "{}",
      "hardware/mainboard/mainboard.kicad_sch": emptySchematic,
      "hardware/mainboard/mainboard.kicad_pcb": emptyBoard,
      "hardware/mainboard/bom.csv": ["Reference,MPN", "U1,MAINBOARD-ONLY-PART"].join("\n"),
      "hardware/sensor/sensor.kicad_pro": "{}",
      "hardware/sensor/sensor.kicad_sch": emptySchematic,
      "hardware/sensor/sensor.kicad_pcb": emptyBoard,
    });

    const result = await runPipeline({ path: root, rules: ["release.revision-set"], failOn: "never" });

    const byProject = new Map(result.boms?.map((bom) => [bom.project, bom.components]) ?? []);
    expect(byProject.get("hardware/mainboard/mainboard.kicad_pro")?.map((row) => row.mpn)).toEqual([
      "MAINBOARD-ONLY-PART",
    ]);
    expect(byProject.get("hardware/sensor/sensor.kicad_pro")).toEqual([]);
  });

  it("does not republish unrecognised source columns from the BOM", async () => {
    const root = await writeFixture({
      "main.kicad_pro": "{}",
      "main.kicad_sch": emptySchematic,
      "main.kicad_pcb": emptyBoard,
      "bom.csv": [
        "Reference,MPN,Internal Cost,Supplier Notes",
        "U1,STM32F103C8T6,42.50,confidential-vendor-terms",
      ].join("\n"),
    });

    const result = await runPipeline({ path: root, rules: ["release.revision-set"], failOn: "never" });

    const serialized = JSON.stringify(result.boms);
    expect(serialized).not.toContain("confidential-vendor-terms");
    expect(serialized).not.toContain("42.50");
    expect(result.boms?.[0]?.components[0]?.mpn).toBe("STM32F103C8T6");
  });
});
