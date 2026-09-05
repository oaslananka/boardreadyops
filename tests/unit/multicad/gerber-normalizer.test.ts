import { describe, expect, it } from "vitest";
import { normalizeGerberStackup } from "../../../src/multicad/gerber-normalizer.js";

describe("Gerber & Drill Layer Normalizer", () => {
  it("normalizes Altium Designer layer extensions into standard roles and stackup", () => {
    const files = [
      { filename: "SensorNode.GTL" },
      { filename: "SensorNode.GBL" },
      { filename: "SensorNode.GTS" },
      { filename: "SensorNode.GBS" },
      { filename: "SensorNode.GTO" },
      { filename: "SensorNode.GBO" },
      { filename: "SensorNode.GTP" },
      { filename: "SensorNode.GBP" },
      { filename: "SensorNode.GM1" },
      { filename: "SensorNode.TXT" },
    ];

    const result = normalizeGerberStackup(files);

    expect(result.layers).toHaveLength(10);
    const topCopper = result.layers.find((l) => l.filename === "SensorNode.GTL");
    expect(topCopper?.role).toBe("copper");
    expect(topCopper?.side).toBe("top");

    const outline = result.layers.find((l) => l.filename === "SensorNode.GM1");
    expect(outline?.role).toBe("outline");

    const drill = result.layers.find((l) => l.filename === "SensorNode.TXT");
    expect(drill?.role).toBe("drill");

    expect(result.capabilities.hasGerberOutlines).toBe(true);
    expect(result.capabilities.hasPlatedHoles).toBe(true);
  });

  it("normalizes KiCad gerber naming conventions", () => {
    const files = [
      { filename: "board-F_Cu.gbr" },
      { filename: "board-B_Cu.gbr" },
      { filename: "board-F_Mask.gbr" },
      { filename: "board-B_Mask.gbr" },
      { filename: "board-F_Silkscreen.gbr" },
      { filename: "board-B_Silkscreen.gbr" },
      { filename: "board-Edge_Cuts.gbr" },
      { filename: "board-PTH.drl" },
      { filename: "board-NPTH.drl" },
    ];

    const result = normalizeGerberStackup(files);

    expect(result.layers.find((l) => l.filename === "board-F_Cu.gbr")?.role).toBe("copper");
    expect(result.layers.find((l) => l.filename === "board-Edge_Cuts.gbr")?.role).toBe("outline");
    expect(result.capabilities.hasPlatedHoles).toBe(true);
    expect(result.capabilities.hasNonPlatedHoles).toBe(true);
  });

  it("extracts dimensions when outline file contains bounding coordinates", () => {
    const outlineContent = `
%MOMM*%
%FSLAX35Y35*%
G01*
X00000000Y00000000D02*
X05000000Y00000000D01*
X05000000Y03000000D01*
X00000000Y03000000D01*
X00000000Y00000000D01*
M02*
`;

    const files = [
      { filename: "board.GTL" },
      { filename: "board.GBL" },
      { filename: "board.GKO", content: outlineContent },
      { filename: "board.DRL" },
    ];

    const result = normalizeGerberStackup(files);
    expect(result.board.widthMm).toBeCloseTo(50.0, 1);
    expect(result.board.heightMm).toBeCloseTo(30.0, 1);
  });

  it("emits a parser warning when no drill files are detected", () => {
    const files = [{ filename: "board.GTL" }, { filename: "board.GBL" }];

    const result = normalizeGerberStackup(files);
    expect(result.capabilities.hasPlatedHoles).toBe(false);
    expect(result.warnings.some((w) => w.code === "MISSING_DRILL")).toBe(true);
  });
});
