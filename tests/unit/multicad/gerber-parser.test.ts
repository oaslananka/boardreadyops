import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseGerber } from "../../../src/multicad/gerber-parser.js";

/**
 * A Gerber file states what it is. Reading that, rather than its filename, is the difference
 * between checking the artwork sent to the fabricator and checking that somebody named a file
 * correctly. These tests hold both halves: what the parser reads, and what it admits it guessed.
 */

const closedSquare = [
  "%FSLAX36Y36*%",
  "%MOMM*%",
  "%TF.FileFunction,Profile,NP*%",
  "D10*",
  "X0Y0D02*",
  "X10000000Y0D01*",
  "X10000000Y10000000D01*",
  "X0Y10000000D01*",
  "X0Y0D01*",
  "M02*",
].join("\n");

describe("parseGerber", () => {
  describe("what the file says it is", () => {
    it("reads copper identity, side and ordinal from TF.FileFunction", () => {
      const top = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L1,Top*%", "M02*"].join("\n"));
      const inner = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L3,Inr*%", "M02*"].join("\n"));
      const bottom = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L4,Bot*%", "M02*"].join("\n"));

      expect(top.identity).toEqual({ role: "copper", side: "top", index: 1 });
      expect(inner.identity).toEqual({ role: "copper", side: "inner", index: 3 });
      expect(bottom.identity).toEqual({ role: "copper", side: "bottom", index: 4 });
    });

    it("maps the non-copper functions onto their roles", () => {
      const cases: Array<[string, string, string]> = [
        ["Soldermask,Top", "soldermask", "top"],
        ["Soldermask,Bot", "soldermask", "bottom"],
        ["Legend,Top", "silkscreen", "top"],
        ["Paste,Bot", "solderpaste", "bottom"],
        ["Profile,NP", "outline", "both"],
      ];

      for (const [value, role, side] of cases) {
        const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", `%TF.FileFunction,${value}*%`, "M02*"].join("\n"));
        expect(result.identity, value).toMatchObject({ role, side });
      }
    });

    it("leaves identity undefined when the file carries no attribute", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "D10*", "X0Y0D03*", "M02*"].join("\n"));

      // Plain RS-274X says nothing about itself, which is not an error -- it is the reason the
      // filename reading still exists. What matters is that the parser does not invent an answer.
      expect(result.identity).toBeUndefined();
      expect(result.fileFunction).toBeUndefined();
    });

    it("keeps the raw value, and says so, for a function that is not a stackup layer", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,AssemblyDrawing,Top*%", "M02*"].join("\n"),
      );

      expect(result.identity).toBeUndefined();
      expect(result.fileFunction).toBe("AssemblyDrawing,Top");
      // Forcing a drawing into a copper or mask role would be worse than declining to classify it.
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.unmodelled-file-function");
    });
  });

  describe("coordinates", () => {
    it("uses the declared format and units", () => {
      const result = parseGerber(closedSquare);

      expect(result.format).toMatchObject({ integerDigits: 3, decimalDigits: 6, evidence: "declared" });
      expect(result.units).toBe("mm");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
    });

    it("converts an inch file to millimetres", () => {
      const result = parseGerber(["%FSLAX24Y24*%", "%MOIN*%", "D10*", "X0Y0D02*", "X10000Y0D01*", "M02*"].join("\n"));

      // 2.4 leading-omitted: "10000" -> 1.0000 inch -> 25.4 mm
      expect(result.boundingBoxMm?.maxX).toBeCloseTo(25.4, 4);
    });

    it("pads the other way when zeros are omitted from the end", () => {
      const leading = parseGerber(["%FSLAX23Y23*%", "%MOMM*%", "X0Y0D02*", "X15D01*", "M02*"].join("\n"));
      const trailing = parseGerber(["%FSTAX23Y23*%", "%MOMM*%", "X0Y0D02*", "X15D01*", "M02*"].join("\n"));

      // L omits leading zeros: "15" -> "00015" -> 00.015
      expect(leading.boundingBoxMm?.maxX).toBeCloseTo(0.015, 5);
      // T omits trailing: "15" -> "15000" -> 15.000
      expect(trailing.boundingBoxMm?.maxX).toBeCloseTo(15, 5);
    });

    it("carries an axis forward when an operation omits it", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*", "X5000000D01*", "Y5000000D01*", "M02*"].join("\n"),
      );

      // `Y5000000D01*` keeps X at 5 mm; reading the missing axis as zero would shrink the box.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    });

    it("says so when it had to assume the format, rather than presenting a guess as a measurement", () => {
      const result = parseGerber(["%MOMM*%", "D10*", "X0Y0D02*", "X1000D01*", "M02*"].join("\n"));

      expect(result.format.evidence).toBe("assumed");
      const assumed = result.warnings.find((entry) => entry.code === "gerber.assumed-coordinate-format");
      expect(assumed?.message).toMatch(/assumption, not a measurement/u);
    });

    it("reads no geometry at all from an incremental file", () => {
      const result = parseGerber(["%FSLIX36Y36*%", "%MOMM*%", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join("\n"));

      // Treating incremental coordinates as absolute produces a plausible, wrong bounding box,
      // which is worse than having none.
      expect(result.boundingBoxMm).toBeUndefined();
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.incremental-coordinates");
    });
  });

  describe("outline closure, which is what makes a board shape usable", () => {
    it("recognises a contour that returns to its start", () => {
      const result = parseGerber(closedSquare);
      expect(result.hasClosedContour).toBe(true);
      expect(result.openContourCount).toBe(0);
    });

    it("counts a contour that never closes", () => {
      const openSquare = [
        "%FSLAX36Y36*%",
        "%MOMM*%",
        "%TF.FileFunction,Profile,NP*%",
        "X0Y0D02*",
        "X10000000Y0D01*",
        "X10000000Y10000000D01*",
        "X0Y10000000D01*",
        "M02*",
      ].join("\n");

      const result = parseGerber(openSquare);
      // Three sides drawn and never joined: the fabricator has no board shape, and this is the
      // single most expensive thing in this file to get wrong.
      expect(result.hasClosedContour).toBe(false);
      expect(result.openContourCount).toBe(1);
    });

    it("treats a region as closed by definition", () => {
      const region = [
        "%FSLAX36Y36*%",
        "%MOMM*%",
        "G36*",
        "X0Y0D02*",
        "X5000000Y0D01*",
        "X5000000Y5000000D01*",
        "G37*",
        "M02*",
      ].join("\n");

      expect(parseGerber(region).hasClosedContour).toBe(true);
    });

    it("does not call a bare flash an open contour", () => {
      const flashes = ["%FSLAX36Y36*%", "%MOMM*%", "D10*", "X1000000Y1000000D03*", "X2000000Y2000000D03*", "M02*"].join(
        "\n",
      );

      const result = parseGerber(flashes);
      // Pads are flashes, not contours. Counting them as unclosed would make every copper layer
      // look broken.
      expect(result.openContourCount).toBe(0);
      expect(result.hasClosedContour).toBe(false);
    });
  });

  describe("against the repository's real fixtures", () => {
    it("reads the EasyEDA outline as a closed 40x30 rectangle", async () => {
      const content = await readFile("tests/fixtures/multicad/easyeda-rp2040/Gerber_BoardOutline.GKO", "utf8");
      const result = parseGerber(content, "Gerber_BoardOutline.GKO");

      expect(result.hasClosedContour).toBe(true);
      expect(result.openContourCount).toBe(0);
      // FSLAX35 is 3.5, so 40000 is 0.4 -- the fixture's numbers are small, and the point is that
      // the parser applies the file's own format rather than a convenient one.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 0.4, minY: 0, maxY: 0.3 });
      // The file declares no %MO%, so units are assumed and the result has to say so.
      expect(result.unitsEvidence).toBe("assumed");
    });

    it("reads the EasyEDA copper layer, which declares no function", async () => {
      const content = await readFile("tests/fixtures/multicad/easyeda-rp2040/Gerber_TopLayer.GTL", "utf8");
      const result = parseGerber(content, "Gerber_TopLayer.GTL");

      expect(result.identity).toBeUndefined();
      expect(result.units).toBe("mm");
      expect(result.unitsEvidence).toBe("declared");
      expect(result.format).toMatchObject({ integerDigits: 3, decimalDigits: 5, evidence: "declared" });
    });

    it("reads the Fusion copper layer's declared format", async () => {
      const content = await readFile(
        "tests/fixtures/multicad/fusion-ble/CAMOutputs/GerberFiles/copper_top.gbr",
        "utf8",
      );
      const result = parseGerber(content, "copper_top.gbr");

      expect(result.format).toMatchObject({ integerDigits: 2, decimalDigits: 5, evidence: "declared" });
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.assumed-coordinate-format");
    });
  });
});
