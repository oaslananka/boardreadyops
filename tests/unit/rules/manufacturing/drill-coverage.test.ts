import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, runFixture, writeFixture } from "../helpers.js";

/**
 * The rule used to ask whether the drill file's raw text `includes` the PCB's drill size, which
 * is wrong in both directions: a size is a substring of unrelated coordinates, and the same
 * diameter written to a different number of decimal places does not match itself. It now compares
 * parsed tool diameters. See #753.
 */

const enabled = "version: 1\nrules:\n  manufacturing.drill-coverage:\n    enabled: true\nfail-on: never\n";

function board(drill: string): string {
  return `(kicad_pcb
  (footprint "Lib:R" (layer "F.Cu") (at 1 1) (property "Reference" "R1")
    (pad "1" thru_hole circle (at 0 0) (size 0.8 0.8) (drill ${drill}))
  )
)`;
}

async function run(files: Record<string, string>) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "boardreadyops.yml": enabled,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.drill-coverage"], failOn: "never" });
}

const drillFile = (tools: string[]) => ["M48", "METRIC,TZ,000.000", ...tools, "%", "M30"].join("\n");

describe("manufacturing.drill-coverage", () => {
  it("flags PCB drill sizes missing from Excellon output", async () => {
    const result = await runFixture("manufacturing-drill-missing");
    const findings = expectRule(result, "manufacturing.drill-coverage", 1);
    expect(findings[0]?.details).toMatchObject({ drillSize: "0.4" });
  });

  it("names the nearest tool the package does contain", async () => {
    const result = await run({ "board.kicad_pcb": board("0.9"), "fab/board.drl": drillFile(["T01C0.300"]) });

    const findings = expectRule(result, "manufacturing.drill-coverage", 1);
    // "No matching tool" leaves the reader opening files to find out what is there instead.
    expect(findings[0]?.message).toContain("the nearest is 0.3 mm");
    expect(findings[0]?.details).toMatchObject({ drillSize: "0.9", nearestToolMm: 0.3, toolsFound: 1 });
  });

  it("matches the same diameter written to a different precision", async () => {
    const result = await run({ "board.kicad_pcb": board("0.4"), "fab/board.drl": drillFile(["T01C0.400"]) });

    // Under the old substring test this direction happened to pass by luck. The reverse -- a board
    // writing 0.40 against a file writing 0.4 -- did not, and raised a finding about a board that
    // was correct.
    expect(expectRule(result, "manufacturing.drill-coverage", 0)).toEqual([]);
  });

  it("matches in the direction the substring check got wrong", async () => {
    const result = await run({ "board.kicad_pcb": board("0.40"), "fab/board.drl": drillFile(["T01C0.4"]) });
    expect(expectRule(result, "manufacturing.drill-coverage", 0)).toEqual([]);
  });

  it("does not accept a coordinate that happens to contain the digits", async () => {
    const result = await run({
      "board.kicad_pcb": board("0.4"),
      // 0.4 appears inside the coordinate `X10.45`, and nowhere in the tool table. The old check
      // read this as covered, so a genuinely missing tool passed the gate.
      "fab/board.drl": ["M48", "METRIC", "T01C0.300", "%", "T01", "X10.45Y2.0", "M30"].join("\n"),
    });

    const findings = expectRule(result, "manufacturing.drill-coverage", 1);
    expect(findings[0]?.details).toMatchObject({ drillSize: "0.4" });
  });

  it("accepts a diameter within the rounding tolerance", async () => {
    const result = await run({ "board.kicad_pcb": board("0.4"), "fab/board.drl": drillFile(["T01C0.4004"]) });
    expect(expectRule(result, "manufacturing.drill-coverage", 0)).toEqual([]);
  });

  it("rejects a diameter outside it", async () => {
    const result = await run({ "board.kicad_pcb": board("0.4"), "fab/board.drl": drillFile(["T01C0.45"]) });

    // Real drill sizes are separated by far more than the tolerance, so 0.45 is a different tool
    // rather than the same one rounded.
    expect(expectRule(result, "manufacturing.drill-coverage", 1)).toHaveLength(1);
  });

  it("matches across several drill files", async () => {
    const result = await run({
      "board.kicad_pcb": board("3.2"),
      "fab/board-PTH.drl": drillFile(["T01C0.300"]),
      "fab/board-NPTH.drl": drillFile(["T01C3.200"]),
    });

    // A mounting hole lives in the non-plated set; looking at one file would report it missing.
    expect(expectRule(result, "manufacturing.drill-coverage", 0)).toEqual([]);
  });

  it("stays quiet when there is no drill file to compare against", async () => {
    const result = await run({ "board.kicad_pcb": board("0.4") });

    // Absence of the whole output set is manufacturing.outputs-present's finding to raise, not a
    // coverage failure. Raising both would report one problem twice.
    expect(expectRule(result, "manufacturing.drill-coverage", 0)).toEqual([]);
  });
});
