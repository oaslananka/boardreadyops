import { describe, expect, it } from "vitest";
import {
  buildNativeCadBatchCommand,
  generateAltiumHeadlessScript,
  generateCadenceSkillScript,
} from "../../../src/multicad/native-cad-adapter.js";

describe("Native CAD Headless Automation Adapters", () => {
  it("generates valid Altium Designer DelphiScript automation", () => {
    const script = generateAltiumHeadlessScript({
      projectPath: "C:/Designs/IoT_Gateway.PrjPcb",
      outputDirectory: "C:/Build/Outputs",
      includeIpc2581: true,
    });

    expect(script).toContain("Procedure RunHeadlessExport;");
    expect(script).toContain("DM_OpenProject('C:/Designs/IoT_Gateway.PrjPcb', True);");
    expect(script).toContain("GenerateGerbers(Project, OutDir);");
    expect(script).toContain("GenerateNCDrill(Project, OutDir);");
    expect(script).toContain("GeneratePickAndPlace(Project, OutDir + '/pick_and_place.csv');");
    expect(script).toContain("GenerateBOM(Project, OutDir + '/bom.csv');");
    expect(script).toContain("GenerateIPC2581(Project, OutDir + '/board.xml');");
  });

  it("generates valid Cadence Allegro SKILL automation script", () => {
    const script = generateCadenceSkillScript({
      boardPath: "/data/designs/server_mainboard.brd",
      outputDirectory: "/data/outputs",
    });

    expect(script).toContain("procedure(RunBoardReadyOpsExport()");
    expect(script).toContain('boardFile = "/data/designs/server_mainboard.brd"');
    expect(script).toContain('axlOpenDesignForBatch(boardFile "r")');
    expect(script).toContain("axlArtworkRun(outDir)");
    expect(script).toContain("axlNCDrillRun(outDir)");
    expect(script).toContain("axlExtractToFile");
    expect(script).toContain("exit(0)");
  });

  it("builds correct batch commands for Altium and Cadence engines", () => {
    const altiumBatch = buildNativeCadBatchCommand("altium", "C:/Hardware/Board.PrjPcb", "C:/Hardware/Out");
    expect(altiumBatch.engine).toBe("altium");
    expect(altiumBatch.executableName).toBe("DXP.EXE");
    expect(altiumBatch.commandLine).toContain("DXP.EXE -RRunScript");
    expect(altiumBatch.scriptFileName).toBe("export_altium.pas");

    const cadenceBatch = buildNativeCadBatchCommand("cadence_allegro", "/eda/boards/card.brd", "/eda/out");
    expect(cadenceBatch.engine).toBe("cadence_allegro");
    expect(cadenceBatch.executableName).toBe("allegro");
    expect(cadenceBatch.commandLine).toContain("allegro -nographics -replay");
    expect(cadenceBatch.scriptFileName).toBe("export_allegro.il");
  });
});
