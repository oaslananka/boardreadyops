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

  describe("gerber content, once it is actually read", () => {
    const outlineWith = (closed: boolean): string =>
      [
        "%FSLAX36Y36*%",
        "%MOMM*%",
        "%TF.FileFunction,Profile,NP*%",
        "X0Y0D02*",
        "X40000000Y0D01*",
        "X40000000Y30000000D01*",
        "X0Y30000000D01*",
        ...(closed ? ["X0Y0D01*"] : []),
        "M02*",
      ].join("\n");

    it("believes the file over its own name when the two disagree", () => {
      // Named as a top solder mask, declares itself inner copper. Before anything opened the file
      // this was a mask layer, and the stackup's copper count was short by one.
      const misnamed = ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L2,Inr*%", "M02*"].join("\n");
      const result = normalizeGerberStackup([
        {
          filename: "board.GTL",
          content: ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L1,Top*%", "M02*"].join("\n"),
        },
        { filename: "board.GTS", content: misnamed },
      ]);

      const layer = result.layers.find((entry) => entry.filename === "board.GTS");
      expect(layer).toMatchObject({ role: "copper", side: "inner", index: 2 });
      expect(result.board.layerCount).toBe(2);
      const disagreement = result.warnings.find((entry) => entry.code === "LAYER_ROLE_FROM_CONTENT");
      expect(disagreement?.message).toMatch(/The file's own declaration is used/u);
    });

    it("keeps the filename reading for a file that declares nothing", () => {
      const plain = ["%FSLAX36Y36*%", "%MOMM*%", "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");
      const result = normalizeGerberStackup([{ filename: "board.GTS", content: plain }]);

      expect(result.layers[0]).toMatchObject({ role: "soldermask", side: "top" });
      expect(result.warnings.some((entry) => entry.code === "LAYER_ROLE_FROM_CONTENT")).toBe(false);
    });

    it("measures the board from the outline's own artwork", () => {
      const result = normalizeGerberStackup([{ filename: "board.gko", content: outlineWith(true) }]);

      expect(result.board.widthMm).toBeCloseTo(40, 6);
      expect(result.board.heightMm).toBeCloseTo(30, 6);
      expect(result.warnings.some((entry) => entry.code === "OUTLINE_NOT_CLOSED")).toBe(false);
    });

    it("reports an outline that never closes, which the source-only check could not see", () => {
      const result = normalizeGerberStackup([{ filename: "board.gko", content: outlineWith(false) }]);

      const open = result.warnings.find((entry) => entry.code === "OUTLINE_NOT_CLOSED");
      // Three sides in the exported artwork and no fourth: the fabricator has no board shape, even
      // though the source .kicad_pcb may be perfectly closed.
      expect(open?.message).toMatch(/never return to their start/u);
    });

    it("carries the gerber parser's assumptions up into the stackup warnings", () => {
      const noFormat = ["%MOMM*%", "D10*", "X0Y0D02*", "X1000D01*", "M02*"].join("\n");
      const result = normalizeGerberStackup([{ filename: "board.gko", content: noFormat }]);

      expect(result.warnings.some((entry) => entry.code === "gerber.assumed-coordinate-format")).toBe(true);
    });

    it("classifies a file whose name means nothing but whose content does", () => {
      const declared = ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L1,Top*%", "M02*"].join("\n");
      const result = normalizeGerberStackup([{ filename: "fab/top-copper.artwork", content: declared }]);

      // classifyLayer has no pattern for this name, and the loop used to skip on that alone --
      // which made the content-first reading conditional on the filename reading having already
      // succeeded, so a layer under an unrecognised name was dropped however clearly it declared
      // itself. The same authority-of-the-filename problem, one level up.
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0]).toMatchObject({ role: "copper", side: "top", index: 1 });
      expect(result.board.layerCount).toBe(1);
    });

    it("still skips a file that neither the name nor the content identifies", () => {
      const result = normalizeGerberStackup([{ filename: "notes.artwork", content: "nothing useful" }]);
      expect(result.layers).toEqual([]);
    });
  });

  describe("what the package's own files account for", () => {
    const declared = (fileFunction: string): string =>
      ["%FSLAX36Y36*%", "%MOMM*%", `%TF.FileFunction,${fileFunction}*%`, "M02*"].join("\n");
    const plain = ["%FSLAX36Y36*%", "%MOMM*%", "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

    it("marks each layer with where its identity came from", () => {
      const result = normalizeGerberStackup([
        { filename: "board.gtl", content: declared("Copper,L1,Top") },
        { filename: "board.gts", content: plain },
      ]);

      // A rule deciding whether a layer is *absent* has to tell the two apart: it may require a
      // layer on a declared identity, never on a filename.
      expect(result.layers.find((entry) => entry.filename === "board.gtl")?.identitySource).toBe("declared");
      expect(result.layers.find((entry) => entry.filename === "board.gts")?.identitySource).toBe("assumed");
      expect(result.identity).toEqual({ declared: 1, assumed: 1, unidentified: 0 });
    });

    it("counts a file it could not place at all, which is where a missing layer may be hiding", () => {
      const result = normalizeGerberStackup([
        { filename: "board.gtl", content: declared("Copper,L1,Top") },
        { filename: "notes.artwork", content: "nothing useful" },
      ]);

      // A layer under a name this reader does not recognise is invisible to it, so the package's
      // inventory is incomplete even though everything it did read was declared.
      expect(result.identity).toEqual({ declared: 1, assumed: 0, unidentified: 1 });
    });

    it("does not count a drill file against the artwork inventory", () => {
      const result = normalizeGerberStackup([
        { filename: "board.gtl", content: declared("Copper,L1,Top") },
        { filename: "board.gts", content: declared("Soldermask,Top") },
        { filename: "board.drl", content: "M48\nMETRIC,TZ,000.000\nT01C0.300\n%\nT01\nX1000Y1000\nM30" },
      ]);

      // A `.drl` is an Excellon program, read on its own terms by the drill reader, and not a
      // Gerbers layer a fabricator would mistake for a stencil. Counting it would mean no real
      // package could ever prove a Gerbers layer absent.
      expect(result.identity).toEqual({ declared: 2, assumed: 0, unidentified: 0 });
      expect(result.layers.find((entry) => entry.filename === "board.drl")?.identitySource).toBe("assumed");
    });

    it("believes a drill-named file that declares itself a Gerbers layer", () => {
      const result = normalizeGerberStackup([{ filename: "board.drl", content: declared("Paste,Top") }]);

      // The drill branch used to run first and the declaration was never read, so a paste layer
      // exported under a drill filename counted as a drill file and as no paste layer at all.
      expect(result.identity).toEqual({ declared: 1, assumed: 0, unidentified: 0 });
      expect(result.layers).toMatchObject([{ filename: "board.drl", role: "solderpaste", side: "top" }]);
    });
  });
});
