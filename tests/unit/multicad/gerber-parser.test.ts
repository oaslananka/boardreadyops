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
  "%ADD10C,0.1*%",
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
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C,0.1*%", "D10*", "X0Y0D03*", "M02*"].join("\n"));

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
      const result = parseGerber(["%MOMM*%", "%ADD10C,0.1*%", "D10*", "X0Y0D02*", "X1000D01*", "M02*"].join("\n"));

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
      const flashes = [
        "%FSLAX36Y36*%",
        "%MOMM*%",
        "%ADD10C,0.1*%",
        "D10*",
        "X1000000Y1000000D03*",
        "X2000000Y2000000D03*",
        "M02*",
      ].join("\n");

      const result = parseGerber(flashes);
      // Pads are flashes, not contours. Counting them as unclosed would make every copper layer
      // look broken.
      expect(result.openContourCount).toBe(0);
      expect(result.hasClosedContour).toBe(false);
    });
  });

  /**
   * A file is a sequence of commands, and where its whitespace falls is not a decision the reader
   * gets to make. These hold the stream: what one command is, what is not a command at all, and
   * what the file states about itself as the stream is read.
   */
  describe("the command stream", () => {
    it("reads several commands from one line without merging them", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "D10*X0Y0D02*X10000000Y0D01*X10000000Y10000000D01*X0Y10000000D01*X0Y0D01*M02*",
        ].join("\n"),
      );

      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(true);
    });

    it("reads a command whose words are separated by whitespace", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "  X0Y0D02*  ", "", "X10000000 Y0 D01 *", "\tM02*"].join("\n"),
      );

      // Whitespace is a separator, not a command, and none of it may cost a coordinate.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("reads a file whose lines end with a carriage return alone", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join("\r"));

      // A `\r` on its own is a line break as much as a `\n` is. Treating only the LF as one would
      // run every command of such a file together and read the whole layer as a single command.
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.unterminated-word-command");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("reads an aperture macro as one command, not as the commands inside it", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "G75*",
          "%ADD11DONUT*%",
          "%AMDONUT*",
          "1,1,$1,0,0*",
          "1,0,$2,0,0*",
          "21,0,$1,0,$3,0*",
          "%",
          "D11*",
          "X0Y0D02*",
          "X10000000Y0D01*",
          "M02*",
        ].join("\n"),
      );

      // A macro body runs over line breaks, so the `%` on its own line closes the command that
      // opened it. Reading it as a command of its own would report a file that is not broken.
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.unterminated-extended-command");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("reads nothing from a comment's payload", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "G04*",
          "G04 flashed at X99999999Y99999999 with D10*",
          "X0Y0D02*",
          "X10000000Y0D01*",
          "M02*",
        ].join("\n"),
      );

      // The commented coordinate is 1000 mm from the origin. Taking it would move the bounding box
      // by a factor of a hundred on a file that draws a 10 mm square.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("does not read a G40, or any other non-comment G-code, as a comment", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "G40*X10000000Y0D01*", "X0Y0D02*", "M02*"].join("\n"));

      // `G40` is a G40, not a `G4` with a stray zero. Reading it as a comment would swallow the
      // coordinate that follows it on the same line.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("does not read a G36 written inside a comment as a region", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "G04 G36*", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join("\n"),
      );

      // A region is closed by definition, so believing this comment would close a contour the file
      // never finished.
      expect(result.hasClosedContour).toBe(false);
      expect(result.openContourCount).toBe(1);
    });

    it("keeps D-codes that look like G-codes from acting like them", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD36C,0.1*%",
          "%ADD70C,0.1*%",
          "%ADD90C,0.1*%",
          "%ADD91C,0.1*%",
          "D36*",
          "D70*",
          "D90*",
          "D91*",
          "X0Y0D02*",
          "X10000000Y0D01*",
          "X0Y10000000D01*",
          "M02*",
        ].join("\n"),
      );

      // Every one of those selects an aperture. `D70` is not an inch and `D91` is not incremental,
      // and `D36` opens no region: the contour below goes three sides and stops.
      expect(result.units).toBe("mm");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(false);
      expect(result.openContourCount).toBe(1);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.incremental-coordinates");
    });

    it("reads no geometry from commands after an M02", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*", "X10000000Y0D01*", "M02*", "X0Y10000000D01*"].join("\n"),
      );

      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });
  });

  describe("commands the file never terminated", () => {
    it("quotes a malformed command in a bounded excerpt, however long it is", () => {
      const noise = "A".repeat(50_000);
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", `G04 ${noise}`, "X0Y0D02*", "M02*"].join("\n"));

      const unterminated = result.warnings.find((entry) => entry.code === "gerber.unterminated-word-command");
      expect(unterminated).toBeDefined();
      // A warning that quoted the whole line would put a 50 kB string in a report, so the excerpt
      // is cut and the rest of the file is summarised.
      expect(unterminated?.message).not.toContain(noise);
      expect(unterminated?.message.length).toBeLessThan(400);
      expect(unterminated?.message).toContain("...");
    });

    it("counts malformed commands instead of listing every one of them", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02", "X1000000Y0D01", "X0Y1000000D01", "M02"].join("\n"),
      );

      const unterminated = result.warnings.filter((entry) => entry.code === "gerber.unterminated-word-command");
      expect(unterminated).toHaveLength(1);
      expect(unterminated[0]?.message).toContain("There are 4 of them");
    });

    it("records an unterminated extended command and still reads what follows it", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "%TF.FileFunction,Copper,L1,Top*", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join(
          "\n",
        ),
        "top.gbr",
      );

      const unterminated = result.warnings.find((entry) => entry.code === "gerber.unterminated-extended-command");
      expect(unterminated?.path).toBe("top.gbr");
      expect(unterminated?.message).toContain("TF.FileFunction");
      // The missing `%` costs that one declaration, not the artwork behind it.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("does not let a stray % swallow the commands around it", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*%", "X10000000Y0D01*", "M02*"].join("\n"));

      // The `%` opens a command that the rest of its line never closes. Reading past it would take
      // the `%` of a later line as its own and lose everything in between; the evidence it leaves
      // is about the `%` alone, and the commands around it are still read.
      expect(result.warnings.map((entry) => entry.code)).toEqual(["gerber.unterminated-extended-command"]);
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("reads no geometry from a command that runs to the end of the file", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*", "X10000000Y0D01"].join("\n"));

      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.unterminated-word-command");
      // The one terminated point is not a bounding box, and the truncated one is not read at all.
      expect(result.boundingBoxMm).toBeUndefined();
    });

    it("does not read a command across a line break the file never terminated", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "X0Y0D02*",
          "X90000000Y9000000",
          "X10000000Y0D01*",
          "X0Y10000000D01*",
          "X0Y0D01*",
          "M02*",
        ].join("\r\n"),
      );

      // Windows line endings, and a `*` missing from the third line. Taking the next line's
      // terminator would merge that command into the line after it and cost a drawn side, so the
      // square would never close.
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.unterminated-word-command");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(true);
      expect(result.openContourCount).toBe(0);
    });
  });

  describe("the deprecated commands older CAM tools still write", () => {
    it("honours a file-level G70, in inches, where the file states no %MO%", () => {
      const result = parseGerber(
        ["%FSLAX24Y24*%", "G70*", "%ADD10C,0.1*%", "D10*", "X0Y0D02*", "X10000Y0D01*", "M02*"].join("\n"),
      );

      expect(result.units).toBe("inch");
      expect(result.unitsEvidence).toBe("declared");
      expect(result.boundingBoxMm?.maxX).toBeCloseTo(25.4, 4);
    });

    it("reads no geometry from a file-level G91 that runs to its M02", () => {
      const result = parseGerber(["G91*", "%ADD10C,0.1*%", "D10*", "X0Y0D02*", "X01000000Y0D01*", "M02*"].join("\n"));

      // The state walk ends at the `M02`, and it has to carry what it learned on the way there:
      // dropping the coordinate mode with the commands would read an incremental file as absolute.
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.incremental-coordinates");
      expect(result.boundingBoxMm).toBeUndefined();
    });
  });

  describe("aperture blocks, whose bodies are not in file scope", () => {
    it("keeps a legacy units command inside a block out of the file state", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "G71*",
          "%ADD10C,0.1*%",
          "D10*",
          "%AB D12*%",
          "D10*",
          "X0Y0D02*",
          "X1000000Y0D01*",
          "G70*",
          "%AB*%",
          "X0Y0D02*",
          "X10000000Y0D01*",
          "M02*",
        ].join("\n"),
      );
      expect(result.units).toBe("mm");
      expect(result.unitsEvidence).toBe("declared");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("keeps a legacy coordinate mode inside a block out of the file state", () => {
      const result = parseGerber(
        [
          "G90*",
          "%ADD10C,0.1*%",
          "D10*",
          "%AB D12*%",
          "D10*",
          "X0Y0D02*",
          "X1000000Y0D01*",
          "G91*",
          "%AB*%",
          "X0Y0D02*",
          "X01000000Y0D01*",
          "M02*",
        ].join("\n"),
      );
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.incremental-coordinates");
    });

    it("does not end the outer file walk at M02 inside a block", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10C,0.1*%",
          "D10*",
          "X0Y0D02*",
          "%AB D12*%",
          "D10*",
          "X0Y0D02*",
          "X1000000Y0D01*",
          "M02*",
          "%AB*%",
          "X10000000Y0D01*",
          "X0Y10000000D01*",
          "X0Y0D01*",
          "M02*",
        ].join("\n"),
      );
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(true);
      expect(result.openContourCount).toBe(0);
    });

    it("keeps block-local word operations out of outer artwork", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10C,0.1*%",
          "D10*",
          "X0Y0D02*",
          "X0Y10000000D01*",
          "%AB D12*%",
          "D10*",
          "X0Y0D02*",
          "X0Y0D01*",
          "%AB*%",
          "M02*",
        ].join("\n"),
      );
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(false);
      expect(result.openContourCount).toBe(1);
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

  /**
   * An aperture is a definition, a selection, and -- for a block -- a place on the layer. They are
   * three commands with three grammars, and which of them a command is decides whether a file is
   * drawing a 0.1 mm pad or a 2.54 mm one, or whether it is broken at all.
   */
  describe("apertures, and the scope each one belongs to", () => {
    it("reads the four standard templates in the units the file declares", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10C,0.1*%",
          "%ADD11R,1.0X2.0*%",
          "%ADD12O,1.0X2.0*%",
          "%ADD13P,0.5X6X30*%",
          "D10*",
          "X0Y0D03*",
          "M02*",
        ].join("\n"),
      );

      expect(result.apertures).toEqual([
        { code: 10, shape: "circle", diameterMm: 0.1, hole: undefined },
        { code: 11, shape: "rectangle", widthMm: 1, heightMm: 2, hole: undefined },
        { code: 12, shape: "obround", widthMm: 1, heightMm: 2, hole: undefined },
        { code: 13, shape: "polygon", diameterMm: 0.5, vertices: 6, rotationDegrees: 30, hole: undefined },
      ]);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.malformed-aperture-definition");
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.unsupported-aperture-definition");
    });

    it("converts a definition with the file's units rather than with millimetres", () => {
      const result = parseGerber(["%FSLAX24Y24*%", "%MOIN*%", "%ADD10C,0.1*%", "M02*"].join("\n"));

      // 0.1 inch is 2.54 mm. Reading the number as millimetres would put the pad 25.4 times too
      // small, and every consumer of the number would believe it.
      expect(result.apertures).toEqual([{ code: 10, shape: "circle", diameterMm: 2.54, hole: undefined }]);
    });

    it("treats hole modifiers as literal diameters even when a matching D-code exists", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10C,0.1*%",
          "%ADD11C,0.2X0.05*%",
          "%ADD14C,0.03*%",
          "%ADD12C,20X14*%",
          "M02*",
        ].join("\n"),
      );
      expect(result.apertures).toEqual([
        { code: 10, shape: "circle", diameterMm: 0.1, hole: undefined },
        { code: 11, shape: "circle", diameterMm: 0.2, hole: { kind: "diameter", diameterMm: 0.05 } },
        { code: 14, shape: "circle", diameterMm: 0.03, hole: undefined },
        { code: 12, shape: "circle", diameterMm: 20, hole: { kind: "diameter", diameterMm: 14 } },
      ]);
      expect(result.warnings).toHaveLength(0);
    });
    it("reads a whole-number hole as a diameter where no aperture of that code exists", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C,0.1*%", "%ADD11C,10X5*%", "%ADD12C,4X5*%", "M02*"].join("\n"),
      );

      // A hole below ten cannot be a D-code, whatever else the file does with the number, and a
      // whole-number hole that is too large for its aperture is caught by the same check as any
      // other: the check runs on the number, not on how the number got read.
      expect(result.apertures).toEqual([
        { code: 10, shape: "circle", diameterMm: 0.1, hole: undefined },
        { code: 11, shape: "circle", diameterMm: 10, hole: { kind: "diameter", diameterMm: 5 } },
        { code: 12, shape: "unmodelled" },
      ]);
      const unsupported = result.warnings.filter((entry) => entry.code === "gerber.unsupported-aperture-definition");
      expect(unsupported).toHaveLength(1);
      expect(unsupported[0]?.message).toContain("5 hole in a circle of 4");
    });

    it("reports a definition no reader can use once, whatever the file repeats it as", () => {
      const broken = Array.from({ length: 9 }, (_unused, index) => `%ADD1${index}C,0.1mm*%`);
      const result = parseGerber(["%MOMM*%", ...broken, "M02*"].join("\n"));

      // A file with a broken `%AD%` in every code it has would otherwise produce a warning per code.
      const malformed = result.warnings.filter((entry) => entry.code === "gerber.malformed-aperture-definition");
      expect(malformed).toHaveLength(5);
      const counted = result.warnings.find((entry) => entry.code === "gerber.unreadable-aperture-definition");
      expect(counted?.message).toContain("4 further definitions");
    });

    it("refuses a malformed number rather than reading the prefix it can", () => {
      const result = parseGerber(["%MOMM*%", "%ADD10C,0.1mm*%", "D10*", "X0Y0D03*", "M02*"].join("\n"));

      const malformed = result.warnings.find((entry) => entry.code === "gerber.malformed-aperture-definition");
      expect(malformed?.message).toContain("0.1mm");
      // `parseFloat("0.1mm")` is 0.1, and a 0.1 mm pad is indistinguishable from a measured one.
      expect(result.apertures).toEqual([{ code: 10, shape: "unmodelled" }]);
    });

    it("rejects a very long malformed numeric tail without accepting its numeric prefix", () => {
      const malformedNumber = `${"9".repeat(20_000)}x`;
      const result = parseGerber(["%MOMM*%", `%ADD10C,${malformedNumber}*%`, "M02*"].join("\n"));
      expect(result.apertures).toEqual([{ code: 10, shape: "unmodelled" }]);
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.malformed-aperture-definition");
    });
    it("counts a definition the grammar cannot read as defined, so selecting it is not a missing one", () => {
      const result = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C-1*%", "D10*", "X0Y0D03*", "M02*"].join("\n"));

      // `%ADD10C-1*%` is not a definition the format allows, so nothing at all is read from it. The
      // file did still assign D10 an aperture, and calling the later `D10*` an undefined one would
      // report a file with two problems where it has the one it wrote.
      const malformed = result.warnings.find((entry) => entry.code === "gerber.malformed-aperture-definition");
      expect(malformed?.message).toContain("ADD10C-1*");
      expect(result.apertures).toEqual([{ code: 10, shape: "unmodelled" }]);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.undefined-aperture");
    });

    it("requires the numbers a template cannot do without", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10R,1.0*%",
          "%ADD11C*%",
          "%ADD12C,0.1X0.2X0.3*%",
          "%ADD13C,0.1X*%",
          "M02*",
        ].join("\n"),
      );

      // A rectangle needs a width and a height, a circle needs a diameter, and neither takes a third
      // number where no third number belongs. Each rejection says which number is the problem,
      // because "malformed" on its own would not be an actionable report.
      const malformed = result.warnings.filter((entry) => entry.code === "gerber.malformed-aperture-definition");
      expect(malformed.map((entry) => entry.message)).toEqual([
        expect.stringContaining("gives no height"),
        expect.stringContaining("no parameters"),
        expect.stringContaining("more than a diameter and a hole"),
        expect.stringContaining("empty hole"),
      ]);
      expect(result.apertures.map((entry) => entry.shape)).toEqual([
        "unmodelled",
        "unmodelled",
        "unmodelled",
        "unmodelled",
      ]);
    });

    it("keeps its uncertainty explicit where a definition cannot be what it says", () => {
      const result = parseGerber(
        [
          "%MOMM*%",
          "%ADD10C,0.1X0.2*%",
          "%ADD11P,0.5X2*%",
          "%ADD12G,1.0*%",
          "%ADD13C*%",
          "D10*",
          "D11*",
          "D12*",
          "D13*",
          "M02*",
        ].join("\n"),
      );

      // A hole bigger than its circle, a polygon of two vertices and a template this reader does not
      // know are all things the file states and no reader can act on. Saying so is the point.
      const unsupported = result.warnings.filter((entry) => entry.code === "gerber.unsupported-aperture-definition");
      expect(unsupported).toHaveLength(3);
      expect(unsupported.map((entry) => entry.message)).toEqual([
        expect.stringContaining("0.2 hole in a circle of 0.1"),
        expect.stringContaining("2 vertices"),
        expect.stringContaining('"G"'),
      ]);
      // The file did assign these codes an aperture, which is not the same thing as having described
      // one this reader can use, so they are defined and not undefined.
      expect(result.apertures.map((entry) => entry.code)).toEqual([10, 11, 12, 13]);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.undefined-aperture");
    });

    it("accepts at most 12 polygon vertices and keeps larger polygons unmodelled", () => {
      const result = parseGerber(["%MOMM*%", "%ADD10P,0.5X12*%", "%ADD11P,0.5X13*%", "M02*"].join("\n"));
      expect(result.apertures[0]).toMatchObject({ code: 10, shape: "polygon", vertices: 12 });
      expect(result.apertures[1]).toEqual({ code: 11, shape: "unmodelled" });
      const unsupported = result.warnings.find((entry) => entry.code === "gerber.unsupported-aperture-definition");
      expect(unsupported?.message).toContain("13 vertices");
      expect(unsupported?.message).toContain("3 to 12");
    });
    it("records a macro aperture as defined without claiming what its body draws", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "%AMDONUT*%", "1,1,$1,0,0*", "%", "%ADD11DONUT,0.5*%", "D11*", "M02*"].join("\n"),
      );

      // A macro body is a statement list this parser does not model, but the aperture the file
      // defined is real: D11 exists, and nothing here says the file failed to define it.
      expect(result.apertures).toEqual([{ code: 11, shape: "macro", macroName: "DONUT" }]);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.undefined-aperture");
    });

    it("reads a selection as a selection and an operation as an operation", () => {
      const operations = parseGerber(["%FSLAX36Y36*%", "%MOMM*%", "X0Y0D02*", "X10000000Y0D01*", "M02*"].join("\n"));

      // `D02` and `D01` are operations. They do not name an aperture, so a file that never selects
      // one is not a file that selected a missing one.
      expect(operations.warnings.map((entry) => entry.code)).not.toContain("gerber.undefined-aperture");
      expect(operations.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });

      const selection = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "G36*", "D36*", "X0Y0D02*", "G37*", "M02*"].join("\n"),
      );

      // A D-code at or above ten is a selection, and this one names something the file never defined.
      const undefinedApertures = selection.warnings.filter((entry) => entry.code === "gerber.undefined-aperture");
      expect(undefinedApertures).toHaveLength(1);
      expect(undefinedApertures[0]?.message).toContain("D36");
    });

    it("reports an aperture the file selects but never defines, once however often it selects it", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "D12*", "X0Y0D02*", "X1000000Y0D01*", "D12*", "X2000000Y0D01*", "M02*"].join("\n"),
      );

      const undefinedApertures = result.warnings.filter((entry) => entry.code === "gerber.undefined-aperture");
      expect(undefinedApertures).toHaveLength(1);
      expect(undefinedApertures[0]?.message).toContain("D12");
      // The artwork is still read: an undefined aperture does not mean the file plotted nothing.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 0 });
    });

    it("reports the same D-code once per scope, in file scope and inside a block", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "D13*",
          "%AB D12*%",
          "D13*",
          "X0Y0D02*",
          "X1000000Y0D01*",
          "%AB*%",
          "D12*",
          "X0Y0D02*",
          "M02*",
        ].join("\n"),
      );
      const undefinedApertures = result.warnings.filter((entry) => entry.code === "gerber.undefined-aperture");
      expect(undefinedApertures).toHaveLength(2);
      expect(undefinedApertures[0]?.message).toMatch(/selects D13/u);
      expect(undefinedApertures[1]?.message).toMatch(/D13 \(in block D12\)/u);
    });

    it("keeps a block-local aperture definition and selection out of file scope", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%AB D12*%",
          "%ADD13C,0.2*%",
          "D13*",
          "X0Y0D02*",
          "X1000000Y0D03*",
          "%AB*%",
          "D12*",
          "D13*",
          "X0Y0D03*",
          "M02*",
        ].join("\n"),
      );
      expect(result.apertures).toEqual([{ code: 12, shape: "block" }]);
      const undefinedApertures = result.warnings.filter((entry) => entry.code === "gerber.undefined-aperture");
      expect(undefinedApertures).toHaveLength(1);
      expect(undefinedApertures[0]?.message).toMatch(/selects D13/u);
    });

    it("selects and places a defined block without calling it undefined", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%AB D12*%",
          "%ADD13C,0.2*%",
          "D13*",
          "X0Y0D02*",
          "X1000000Y1000000D03*",
          "%AB*%",
          "D12*",
          "X1000000Y1000000D03*",
          "X2000000Y2000000D03*",
          "M02*",
        ].join("\n"),
      );
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.undefined-aperture");
      const placement = result.warnings.find((entry) => entry.code === "gerber.unmodelled-aperture-block");
      expect(placement?.message).toContain("D12");
      expect(placement?.message).toContain("2 times");
      expect(placement?.message).toMatch(/flash point only/u);
      expect(result.boundingBoxMm).toEqual({ minX: 1, maxX: 2, minY: 1, maxY: 2 });
    });

    it("lets a block select a file-scope aperture without leaking a block-local one", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "%ADD10C,0.2X0.05*%",
          "%AB D12*%",
          "D10*",
          "X0Y0D02*",
          "X1000000Y0D01*",
          "%ADD13C,0.4*%",
          "D13*",
          "X2000000Y0D03*",
          "%AB*%",
          "D12*",
          "X0Y0D03*",
          "D13*",
          "M02*",
        ].join("\n"),
      );
      expect(result.apertures).toEqual([
        { code: 10, shape: "circle", diameterMm: 0.2, hole: { kind: "diameter", diameterMm: 0.05 } },
        { code: 12, shape: "block" },
      ]);
      const undefinedApertures = result.warnings.filter((entry) => entry.code === "gerber.undefined-aperture");
      expect(undefinedApertures).toHaveLength(1);
      expect(undefinedApertures[0]?.message).toMatch(/selects D13/u);
    });

    it("does not register a block that was never closed", () => {
      const result = parseGerber(
        ["%FSLAX36Y36*%", "%MOMM*%", "%AB D12*%", "%ADD13C,0.2*%", "D13*", "X0Y0D03*", "D12*", "M02*"].join("\n"),
      );
      expect(result.apertures).toEqual([]);
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.unmodelled-aperture-block");
    });
  });
});
