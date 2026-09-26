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
          "%ADD11C,0.100*%",
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
      const result = parseGerber(["%FSLAX24Y24*%", "G70*", "D10*", "X0Y0D02*", "X10000Y0D01*", "M02*"].join("\n"));

      expect(result.units).toBe("inch");
      expect(result.unitsEvidence).toBe("declared");
      expect(result.boundingBoxMm?.maxX).toBeCloseTo(25.4, 4);
    });

    it("reads no geometry from a file-level G91 that runs to its M02", () => {
      const result = parseGerber(["G91*", "D10*", "X0Y0D02*", "X01000000Y0D01*", "M02*"].join("\n"));

      // The state walk ends at the `M02`, and it has to carry what it learned on the way there:
      // dropping the coordinate mode with the commands would read an incremental file as absolute.
      expect(result.warnings.map((entry) => entry.code)).toContain("gerber.incremental-coordinates");
      expect(result.boundingBoxMm).toBeUndefined();
    });
  });

  describe("aperture blocks, whose bodies are not in file scope", () => {
    it("keeps a legacy units command inside a block out of the file's state", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "G71*",
          "D10*",
          "%AB D12*%",
          "G70*",
          "1,1,0,0,0.5*",
          "%AB*%",
          "X0Y0D02*",
          "X10000000Y0D01*",
          "M02*",
        ].join("\n"),
      );

      // A G70 in the block body is a macro statement about inches; the file said millimetres.
      // Reading it would scale the whole layer by 25.4.
      expect(result.units).toBe("mm");
      expect(result.unitsEvidence).toBe("declared");
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
    });

    it("keeps a legacy coordinate mode inside a block out of the file's state", () => {
      const result = parseGerber(
        ["G90*", "D10*", "%AB D12*%", "G91*", "1,1,0,0,0.5*", "%AB*%", "X0Y0D02*", "X01000000Y0D01*", "M02*"].join(
          "\n",
        ),
      );

      // The file states no %FS%, so the G90 in file scope is the only account of its coordinate
      // mode. Leaking the block's G91 would switch the file to incremental coordinates, which this
      // parser refuses to interpret at all.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 0 });
      expect(result.warnings.map((entry) => entry.code)).not.toContain("gerber.incremental-coordinates");
    });

    it("does not end the file walk at an M02 inside a block", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "D10*",
          "X0Y0D02*",
          "%AB D12*%",
          "M02*",
          "1,1,0,0,0.5*",
          "%AB*%",
          "X10000000Y0D01*",
          "X0Y10000000D01*",
          "X0Y0D01*",
          "M02*",
        ].join("\n"),
      );

      // The artwork behind the block is the board outline. Ending the walk at the block's M02 would
      // leave one point of it read, and no board shape at all.
      expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
      expect(result.hasClosedContour).toBe(true);
      expect(result.openContourCount).toBe(0);
    });

    it("reads nothing from a block body as artwork", () => {
      const result = parseGerber(
        [
          "%FSLAX36Y36*%",
          "%MOMM*%",
          "D10*",
          "X0Y0D02*",
          "X0Y10000000D01*",
          "%AB D12*%",
          "X0Y0D01*",
          "%AB*%",
          "M02*",
        ].join("\n"),
      );

      // A `D01` inside a block body is a circle primitive of a macro, not a drawn line. Plotting it
      // would close this contour, and the file would report a board shape it never drew.
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
});
