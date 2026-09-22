import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

const enabled = "version: 1\nrules:\n  manufacturing.board-edge-clearance:\n    enabled: true\nfail-on: never\n";

const header = ["%FSLAX35Y35*%", "%MOMM*%"];
const outlineGerber = (minX: number, minY: number, maxX: number, maxY: number) =>
  [
    ...header,
    "%TF.FileFunction,Profile,NP*%",
    `X${minX * 100000}Y${minY * 100000}D02*`,
    `X${maxX * 100000}Y${minY * 100000}D01*`,
    `X${maxX * 100000}Y${maxY * 100000}D01*`,
    `X${minX * 100000}Y${maxY * 100000}D01*`,
    `X${minX * 100000}Y${minY * 100000}D01*`,
    "M02*",
  ].join("\n");

const copperGerber = (minX: number, minY: number, maxX: number, maxY: number, side: "Top" | "Bot" = "Top") =>
  [
    ...header,
    `%TF.FileFunction,Copper,L1,${side}*%`,
    `X${minX * 100000}Y${minY * 100000}D02*`,
    `X${maxX * 100000}Y${maxY * 100000}D01*`,
    "M02*",
  ].join("\n");

const emptyGerber = [...header, "%TF.FileFunction,Copper,L1,Top*%", "M02*"].join("\n");

async function run(files: Record<string, string>, configText = enabled) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": '(kicad_pcb (footprint "Lib:R" (layer "F.Cu") (at 1 1) (property "Reference" "R1")))',
    "boardreadyops.yml": configText,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.board-edge-clearance"], failOn: "never" });
}

describe("manufacturing.board-edge-clearance", () => {
  it("passes when copper has sufficient board edge clearance", async () => {
    const result = await run({
      "fab/outline.gko": outlineGerber(0, 0, 100, 100),
      "fab/top.gtl": copperGerber(1, 1, 99, 99),
      "fab/empty.gbr": emptyGerber,
    });

    expect(expectRule(result, "manufacturing.board-edge-clearance", 0)).toEqual([]);
  });

  it("flags copper that violates board edge clearance limit", async () => {
    const result = await run({
      "fab/outline.gko": outlineGerber(0, 0, 100, 100),
      "fab/top.gtl": copperGerber(0.1, 0.1, 99.9, 99.9),
      "fab/bottom.gbl": copperGerber(0.05, 0.05, 99.95, 99.95, "Bot"),
    });

    const findings = expectRule(result, "manufacturing.board-edge-clearance", 2);
    const measured = findings.map((f) => f.details?.measuredClearanceMm).sort();
    expect(measured).toEqual([0.05, 0.1]);

    expect(findings[0]?.fix?.description).toContain("Pull copper features back at least 0.2mm");
    expect(findings[0]?.fix?.steps).toHaveLength(4);
    expect(findings[0]?.fix?.steps?.[0]).toContain("Open PCB Editor in KiCad.");
    expect(findings[0]?.details).toMatchObject({
      minClearanceMm: 0.2,
      confidence: "exact",
      profileRevision: expect.any(String),
      profileSource: expect.any(String),
    });
  });

  it("respects custom min-clearance-mm config override", async () => {
    const customConfig =
      "version: 1\nrules:\n  manufacturing.board-edge-clearance:\n    enabled: true\n    min-clearance-mm: 0.5\nfail-on: never\n";
    const result = await run(
      {
        "fab/outline.gko": outlineGerber(0, 0, 100, 100),
        "fab/top.gtl": copperGerber(0.4, 0.4, 99.6, 99.6),
      },
      customConfig,
    );

    const findings = expectRule(result, "manufacturing.board-edge-clearance", 1);
    expect(findings[0]?.details).toMatchObject({
      measuredClearanceMm: 0.4,
      minClearanceMm: 0.5,
    });
  });

  it("reports unknown confidence when board outline is missing or open", async () => {
    const openOutline = [...header, "%TF.FileFunction,Profile,NP*%", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join("\n");

    const result = await run({
      "fab/outline.gko": openOutline,
      "fab/top.gtl": copperGerber(1, 1, 99, 99),
    });

    const findings = expectRule(result, "manufacturing.board-edge-clearance", 1);
    expect(findings[0]?.message).toContain("outline is missing or open");
    expect(findings[0]?.details).toMatchObject({
      confidence: "unknown",
      outlineClosed: false,
    });
  });

  it("returns no findings when rule is disabled or no Gerbers exist", async () => {
    const disabledConfig =
      "version: 1\nrules:\n  manufacturing.board-edge-clearance:\n    enabled: false\nfail-on: never\n";
    const disabledRes = await run(
      {
        "fab/outline.gko": outlineGerber(0, 0, 100, 100),
        "fab/top.gtl": copperGerber(0.1, 0.1, 99.9, 99.9),
      },
      disabledConfig,
    );
    expect(expectRule(disabledRes, "manufacturing.board-edge-clearance", 0)).toEqual([]);

    const noGerbersRes = await run({});
    expect(expectRule(noGerbersRes, "manufacturing.board-edge-clearance", 0)).toEqual([]);
  });
});
