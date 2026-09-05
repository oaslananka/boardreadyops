import { describe, expect, it } from "vitest";
import { detectPackageFormat } from "../../../src/multicad/detector.js";

describe("Universal Multi-CAD Format Detector", () => {
  it("detects KiCad projects by file extensions and header signatures", async () => {
    const files = ["board.kicad_pro", "board.kicad_pcb", "board.kicad_sch"];

    const result = await detectPackageFormat(files, async () => "(kicad_pcb (version 20240108))");
    expect(result.format).toBe("kicad");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects Altium Designer packages by file extension and comment header", async () => {
    const files = [
      "Board.GTL",
      "Board.GBL",
      "Board.GTO",
      "Board.GBO",
      "Board.GTS",
      "Board.GBS",
      "Board.GM1",
      "Board.TXT",
      "Status Report.Txt",
    ];

    const result = await detectPackageFormat(files, async (file) => {
      if (file === "Board.GTL") return "G04 Altium Designer 24.1.1 (Build 28) *\n%FSLAX25Y25*%";
      return "";
    });

    expect(result.format).toBe("altium");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("detects EasyEDA packages by export structure and signature comments", async () => {
    const files = [
      "Gerber_TopLayer.GTL",
      "Gerber_BottomLayer.GBL",
      "Gerber_BoardOutline.GKO",
      "BOM_export.csv",
      "PickAndPlace_export.csv",
    ];

    const result = await detectPackageFormat(files, async (file) => {
      if (file === "Gerber_TopLayer.GTL") return "G04 EasyEDA Pro v2.2.18.2 *\n%FSLAX35Y35*%";
      return "";
    });

    expect(result.format).toBe("easyeda");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("detects Autodesk Fusion Electronics from CAMOutputs hierarchy", async () => {
    const files = [
      "CAMOutputs/GerberFiles/copper_top.gbr",
      "CAMOutputs/GerberFiles/copper_bottom.gbr",
      "CAMOutputs/DrillFiles/drill_1_16.xln",
      "CAMOutputs/Assembly/bom.csv",
    ];

    const result = await detectPackageFormat(files, async () => "%FSLAX25Y25*%");
    expect(result.format).toBe("fusion360");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("falls back to generic_gerber when no vendor signature exists", async () => {
    const files = ["layer1.gbr", "layer2.gbr", "drill.drl"];

    const result = await detectPackageFormat(files, async () => "%FSLAX25Y25*%");
    expect(result.format).toBe("generic_gerber");
    expect(result.confidence).toBeLessThan(0.7);
  });
});
