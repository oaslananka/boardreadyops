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

  describe("drill content, once it is actually read", () => {
    const nonPlatedOnly = [
      "M48",
      "METRIC,TZ,000.000",
      "; #@! TF.FileFunction,NonPlated,1,2,NPTH",
      "T01C3.200",
      "%",
      "T01",
      "X5000Y5000",
      "M30",
    ].join("\n");

    it("stops claiming plated holes for a bundle that declares only non-plated ones", () => {
      const result = normalizeGerberStackup([
        { filename: "board.GTL" },
        { filename: "board.GBL" },
        { filename: "board.drl", content: nonPlatedOnly },
      ]);

      // The filename says nothing -- no `-NPTH` suffix -- and the old rule was "any drill file at
      // all means plated holes", so this bundle used to report plated holes it does not contain.
      // The file itself says NonPlated, and the file wins.
      expect(result.capabilities.hasPlatedHoles).toBe(false);
      expect(result.capabilities.hasNonPlatedHoles).toBe(true);
    });

    it("returns the holes themselves rather than an empty array", () => {
      const result = normalizeGerberStackup([
        { filename: "board.GTL" },
        { filename: "board.drl", content: nonPlatedOnly },
      ]);

      expect(result.drillHoles).toEqual([{ xMm: 5, yMm: 5, diameterMm: 3.2, plated: false }]);
    });

    it("keeps the filename reading when the file declares nothing", () => {
      const silent = ["M48", "METRIC,TZ,000.000", "T01C0.300", "%", "T01", "X1000Y1000", "M30"].join("\n");
      const result = normalizeGerberStackup([
        { filename: "board.GTL" },
        { filename: "board-PTH.drl", content: silent },
        { filename: "board-NPTH.drl", content: silent },
      ]);

      // Neither file states plating, so the suffixes are all there is to go on. That is a fallback
      // and the result says so, rather than presenting it as read from the files.
      expect(result.capabilities.hasPlatedHoles).toBe(true);
      expect(result.capabilities.hasNonPlatedHoles).toBe(true);
      expect(result.warnings.some((w) => w.code === "excellon.assumed-plating")).toBe(true);
    });

    it("says when a drill file arrived with no content to read", () => {
      const result = normalizeGerberStackup([{ filename: "board.GTL" }, { filename: "board.drl" }]);

      expect(result.drillHoles).toEqual([]);
      const unavailable = result.warnings.find((w) => w.code === "DRILL_CONTENT_UNAVAILABLE");
      expect(unavailable?.message).toMatch(/rests on the filename/u);
      // Behaviour for content-less bundles is unchanged: the filename is still the only source,
      // and it still reports plated holes. What changed is that it now admits as much.
      expect(result.capabilities.hasPlatedHoles).toBe(true);
    });

    it("carries the parser's own assumptions up into the stackup warnings", () => {
      const noFormat = ["M48", "METRIC", "T01C0.400", "%", "T01", "X1000Y1000", "M30"].join("\n");
      const result = normalizeGerberStackup([{ filename: "board.drl", content: noFormat }]);

      // A coordinate whose format was guessed must not look measured by the time it reaches a rule.
      expect(result.warnings.some((w) => w.code === "excellon.assumed-coordinate-format")).toBe(true);
    });
  });
});
