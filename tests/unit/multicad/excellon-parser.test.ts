import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseExcellon } from "../../../src/multicad/excellon-parser.js";

/**
 * The parser's job is to be right, and where it cannot be right, to say so. These tests weight
 * the second half as heavily as the first, because a drill reader that silently guesses a
 * coordinate format produces numbers that look measured and are wrong by a power of ten -- and a
 * rule that blocks a release on one of those will block a good board.
 */

describe("parseExcellon", () => {
  it("reads tools and holes from a metric file", () => {
    const result = parseExcellon(["M48", "METRIC,TZ", "T01C0.400", "%", "T01", "X1000Y2000", "M30"].join("\n"));

    expect(result.units).toBe("mm");
    expect(result.tools).toEqual([{ code: "01", diameterMm: 0.4, plated: undefined }]);
    // 3.3 assumed, leading zeros suppressed: "1000" pads to "001000" -> 001.000
    expect(result.holes).toEqual([{ xMm: 1, yMm: 2, diameterMm: 0.4, plated: true }]);
  });

  it("says so when it had to assume the coordinate format", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.4", "%", "T01", "X1000Y1000", "M30"].join("\n"));

    expect(result.format.evidence).toBe("assumed");
    const codes = result.warnings.map((entry) => entry.code);
    expect(codes).toContain("excellon.assumed-coordinate-format");
    // The message has to be usable by whoever reads the report, not just a flag.
    const assumed = result.warnings.find((entry) => entry.code === "excellon.assumed-coordinate-format");
    expect(assumed?.message).toMatch(/assumption, not a measurement/u);
  });

  it("treats a declared format as declared, and uses it", () => {
    const result = parseExcellon(["M48", "METRIC,TZ,000.00", "T01C0.4", "%", "T01", "X12345Y00100", "M30"].join("\n"));

    expect(result.format).toMatchObject({ integerDigits: 3, decimalDigits: 2, evidence: "declared" });
    // 3.2 with leading zeros suppressed: "12345" -> 123.45
    expect(result.holes[0]?.xMm).toBeCloseTo(123.45, 5);
    expect(result.holes[0]?.yMm).toBeCloseTo(1, 5);
    expect(result.warnings.map((entry) => entry.code)).not.toContain("excellon.assumed-coordinate-format");
  });

  it("reads FILE_FORMAT when that is how the format is stated", () => {
    const result = parseExcellon(
      ["M48", "METRIC", ";FILE_FORMAT=4:3", "T01C0.4", "%", "T01", "X1234567", "Y1", "M30"].join("\n"),
    );
    expect(result.format).toMatchObject({ integerDigits: 4, decimalDigits: 3, evidence: "declared" });
  });

  it("pads the opposite way for LZ, because the names mean the opposite of how they read", () => {
    const leadingSuppressed = parseExcellon(
      ["M48", "METRIC,TZ,00.000", "T01C0.4", "%", "T01", "X15Y15", "M30"].join("\n"),
    );
    const trailingSuppressed = parseExcellon(
      ["M48", "METRIC,LZ,00.000", "T01C0.4", "%", "T01", "X15Y15", "M30"].join("\n"),
    );

    // TZ keeps trailing zeros, so leading ones are dropped: "15" -> "00015" -> 00.015
    expect(leadingSuppressed.holes[0]?.xMm).toBeCloseTo(0.015, 6);
    // LZ keeps leading zeros, so trailing ones are dropped: "15" -> "15000" -> 15.000
    expect(trailingSuppressed.holes[0]?.xMm).toBeCloseTo(15, 6);
    // Getting this backwards is a factor of a thousand, which is the whole point of the test.
    expect(leadingSuppressed.holes[0]?.xMm).not.toBeCloseTo(trailingSuppressed.holes[0]?.xMm ?? 0, 6);
  });

  it("takes an explicit decimal point at face value", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.4", "%", "T01", "X12.7Y-3.5", "M30"].join("\n"));
    expect(result.holes[0]).toMatchObject({ xMm: 12.7, yMm: -3.5 });
  });

  it("converts inch files, tool diameters included", () => {
    const result = parseExcellon(["M48", "INCH,TZ,00.0000", "T01C0.0394", "%", "T01", "X10000Y5000", "M30"].join("\n"));

    expect(result.units).toBe("inch");
    expect(result.tools[0]?.diameterMm).toBeCloseTo(1.00076, 4);
    // 2.4 leading-suppressed: "10000" -> 01.0000 inch -> 25.4 mm
    expect(result.holes[0]?.xMm).toBeCloseTo(25.4, 3);
    expect(result.holes[0]?.yMm).toBeCloseTo(12.7, 3);
  });

  it("reads plating from a file-level attribute", () => {
    const plated = parseExcellon(
      ["M48", "METRIC", "; #@! TF.FileFunction,Plated,1,2,PTH", "T01C0.4", "%", "T01", "X1Y1", "M30"].join("\n"),
    );
    const nonPlated = parseExcellon(
      ["M48", "METRIC", "; #@! TF.FileFunction,NonPlated,1,2,NPTH", "T01C1.0", "%", "T01", "X1Y1", "M30"].join("\n"),
    );

    expect(plated.platedEvidence).toBe("declared");
    expect(plated.holes[0]?.plated).toBe(true);
    expect(nonPlated.holes[0]?.plated).toBe(false);
    expect(nonPlated.tools[0]?.plated).toBe(false);
  });

  it("reads plating per tool, which overrides the file default", () => {
    const result = parseExcellon(
      [
        "M48",
        "METRIC",
        "; #@! TF.FileFunction,Plated,1,2,PTH",
        "; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill",
        "T02C3.0",
        "T01C0.4",
        "%",
        "T02",
        "X1Y1",
        "T01",
        "X2Y2",
        "M30",
      ].join("\n"),
    );

    // The attribute attaches to the tool defined after it and must not leak onto the next one.
    expect(result.tools.find((tool) => tool.code === "02")?.plated).toBe(false);
    expect(result.tools.find((tool) => tool.code === "01")?.plated).toBe(true);
    expect(result.holes.map((hole) => hole.plated)).toEqual([false, true]);
  });

  it("admits when nothing states plating rather than asserting plated", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.4", "%", "T01", "X1Y1", "M30"].join("\n"));

    expect(result.platedEvidence).toBe("assumed");
    expect(result.tools[0]?.plated).toBeUndefined();
    const assumed = result.warnings.find((entry) => entry.code === "excellon.assumed-plating");
    expect(assumed?.message).toMatch(/must not block a release/u);
  });

  it("reads the legacy TYPE=PLATED comment", () => {
    const result = parseExcellon(
      ["M48", "METRIC", ";TYPE=NON_PLATED", "T01C1.0", "%", "T01", "X1Y1", "M30"].join("\n"),
    );
    expect(result.platedEvidence).toBe("declared");
    expect(result.holes[0]?.plated).toBe(false);
  });

  it("counts slots and says their length is not represented", () => {
    const result = parseExcellon(
      ["M48", "METRIC,TZ,000.000", "T01C1.0", "%", "T01", "X1000Y1000G85X4000Y1000", "M30"].join("\n"),
    );

    expect(result.slotCount).toBe(1);
    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]).toMatchObject({ xMm: 1, yMm: 1 });
    expect(result.warnings.find((entry) => entry.code === "excellon.slots-collapsed")?.message).toMatch(
      /slot length is not represented/u,
    );
  });

  it("does not silently drop holes drilled with an undefined tool", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.4", "%", "T09", "X1Y1", "M30"].join("\n"));

    expect(result.holes).toHaveLength(0);
    // Dropping them quietly would understate the drill count, which a coverage rule would then
    // read as a clean board.
    expect(result.warnings.map((entry) => entry.code)).toContain("excellon.undefined-tool");
  });

  it("reports a coordinate that arrives before any tool selection", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.4", "%", "X1Y1", "M30"].join("\n"));
    expect(result.holes).toHaveLength(0);
    expect(result.warnings.map((entry) => entry.code)).toContain("excellon.hole-before-tool");
  });

  it("rejects an unusable tool diameter instead of recording a zero-width hole", () => {
    const result = parseExcellon(["M48", "METRIC", "T01C0.000", "%", "T01", "X1Y1", "M30"].join("\n"));
    expect(result.tools).toHaveLength(0);
    expect(result.warnings.map((entry) => entry.code)).toContain("excellon.invalid-tool-diameter");
  });

  it("stops at M30 and ignores anything after it", () => {
    const result = parseExcellon(
      ["M48", "METRIC,TZ,000.000", "T01C0.4", "%", "T01", "X1000Y1000", "M30", "X9000Y9000"].join("\n"),
    );
    expect(result.holes).toHaveLength(1);
  });

  it("survives a file with no body at all", () => {
    const result = parseExcellon(["M48", "METRIC,TZ", "T01C0.400", "%"].join("\n"));
    expect(result.holes).toHaveLength(0);
    expect(result.tools).toHaveLength(1);
  });

  describe("against the repository's real fixtures", () => {
    it("reads the EasyEDA PTH file", async () => {
      const content = await readFile("tests/fixtures/multicad/easyeda-rp2040/Drill_PTH.DRL", "utf8");
      const result = parseExcellon(content, "Drill_PTH.DRL");

      expect(result.tools.map((tool) => tool.diameterMm)).toEqual([0.4, 0.9]);
      expect(result.holes).toHaveLength(2);
      expect(result.holes.map((hole) => hole.diameterMm)).toEqual([0.4, 0.9]);
      // The file declares METRIC but no format, so the coordinates are an assumption and the
      // result must say so rather than presenting 1 mm as measured.
      expect(result.format.evidence).toBe("assumed");
      expect(result.holes[0]).toMatchObject({ xMm: 1, yMm: 1 });
    });

    it("reads the Fusion drill file", async () => {
      const content = await readFile("tests/fixtures/multicad/fusion-ble/CAMOutputs/DrillFiles/drill_1_16.xln", "utf8");
      const result = parseExcellon(content, "drill_1_16.xln");

      expect(result.tools).toHaveLength(1);
      expect(result.holes).toHaveLength(2);
      expect(result.holes.every((hole) => hole.diameterMm === 0.3)).toBe(true);
    });

    it("reads a header-only JLCPCB file without inventing holes", async () => {
      const content = await readFile("tests/fixtures/projects/jlcpcb-complete/fab/board.drl", "utf8");
      const result = parseExcellon(content, "board.drl");

      expect(result.tools).toEqual([{ code: "01", diameterMm: 0.4, plated: undefined }]);
      expect(result.holes).toHaveLength(0);
      // `METRIC,TZ` states the suppression but not the digit counts, so the format is still an
      // assumption -- worth asserting, because it is the most common real-world shape.
      expect(result.format.zeroSuppression).toBe("leading-suppressed");
      expect(result.format.evidence).toBe("assumed");
    });
  });
});
