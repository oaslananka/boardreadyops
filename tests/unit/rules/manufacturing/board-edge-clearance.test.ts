import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

type Point = { x: number; y: number };

const enabled = "version: 1\nrules:\n  manufacturing.board-edge-clearance:\n    enabled: true\nfail-on: never\n";
const configuredLimit = (minimum = 0.2) =>
  `version: 1
rules:
  manufacturing.board-edge-clearance:
    enabled: true
    min-clearance-mm: ${minimum}
fail-on: never
`;

const header = ["%FSLAX35Y35*%", "%MOMM*%"];

function coordinate(value: number): number {
  return Math.round(value * 100_000);
}

function position(point: Point, operation: "D01" | "D02" | "D03"): string {
  return `X${coordinate(point.x)}Y${coordinate(point.y)}${operation}*`;
}

function outlineGerber(points: readonly Point[], declared = true): string {
  const first = points[0] as Point;
  return [
    ...header,
    ...(declared ? ["%TF.FileFunction,Profile,NP*%"] : []),
    "%ADD10C,0.01*%",
    "D10*",
    position(first, "D02"),
    ...points.slice(1).map((point) => position(point, "D01")),
    position(first, "D01"),
    "M02*",
  ].join("\n");
}

function traceGerber(
  from: Point,
  to: Point,
  diameterMm = 0.2,
  options: { declared?: boolean; fileFunction?: string; transform?: string; aperture?: string } = {},
): string {
  const declared = options.declared ?? true;
  const fileFunction = options.fileFunction ?? "Copper,L1,Top";
  return [
    ...header,
    ...(declared ? [`%TF.FileFunction,${fileFunction}*%`] : []),
    options.aperture ?? `%ADD10C,${diameterMm}*%`,
    "D10*",
    ...(options.transform ? [options.transform] : []),
    position(from, "D02"),
    position(to, "D01"),
    "M02*",
  ].join("\n");
}

function flashGerber(at: Point, diameterMm = 0.2): string {
  return [
    ...header,
    "%TF.FileFunction,Copper,L1,Top*%",
    `%ADD10C,${diameterMm}*%`,
    "D10*",
    position(at, "D03"),
    "M02*",
  ].join("\n");
}

function flashWithAperture(at: Point, definition: string): string {
  return [...header, "%TF.FileFunction,Copper,L1,Top*%", definition, "D10*", position(at, "D03"), "M02*"].join("\n");
}

function regionGerber(points: readonly Point[]): string {
  const first = points[0] as Point;
  return [
    ...header,
    "%TF.FileFunction,Copper,L1,Top*%",
    "G36*",
    position(first, "D02"),
    ...points.slice(1).map((point) => position(point, "D01")),
    position(first, "D01"),
    "G37*",
    "M02*",
  ].join("\n");
}

async function run(files: Record<string, string>, configText = enabled) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": '(kicad_pcb (footprint "Lib:R" (layer "F.Cu") (at 1 1) (property "Reference" "R1")))',
    "boardreadyops.yml": configText,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.board-edge-clearance"], failOn: "never" });
}

const squareOutline = outlineGerber([
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]);

describe("manufacturing.board-edge-clearance", () => {
  it("blocks on an explicit limit using trace geometry and the circular aperture radius", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }),
      },
      configuredLimit(),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.severity).toBe("medium");
    expect(finding?.confidence).toBe("definite");
    expect(finding?.details).toMatchObject({
      measuredClearanceMm: 0.15,
      minClearanceMm: 0.2,
      limitSource: "configured",
      layerRole: "copper",
      layerRoleEvidence: "declared",
      outlineRoleEvidence: "declared",
      featureKind: "trace",
      featureExtentEvidence: "circle",
      geometryConfidence: "exact",
      configuredSeverity: "medium",
      severityCapped: false,
      blocking: true,
    });
  });

  it("measures a flash to its copper edge rather than to its centre", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": flashGerber({ x: 0.25, y: 5 }),
      },
      configuredLimit(),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.details).toMatchObject({
      measuredClearanceMm: 0.15,
      featureKind: "flash",
      featureExtentEvidence: "circle",
      blocking: true,
    });
  });

  it("measures a filled region from its contour and catches an edge crossing", async () => {
    const near = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": regionGerber([
          { x: 0.1, y: 2 },
          { x: 1, y: 2 },
          { x: 1, y: 4 },
          { x: 0.1, y: 4 },
        ]),
      },
      configuredLimit(),
    );
    expect(expectRule(near, "manufacturing.board-edge-clearance", 1)[0]?.details).toMatchObject({
      measuredClearanceMm: 0.1,
      featureKind: "region",
      featureExtentEvidence: "filled-region-contour",
      blocking: true,
    });

    const crossing = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: -0.5, y: 5 }, { x: 0.5, y: 5 }, 0.1),
      },
      configuredLimit(),
    );
    expect(expectRule(crossing, "manufacturing.board-edge-clearance", 1)[0]?.details).toMatchObject({
      measuredClearanceMm: 0,
      featureKind: "trace",
      blocking: true,
    });
  });

  it("measures a trace parallel to a diagonal board edge from the nearest geometry", async () => {
    const diamond = outlineGerber([
      { x: 0, y: 5 },
      { x: 5, y: 10 },
      { x: 10, y: 5 },
      { x: 5, y: 0 },
    ]);
    const result = await run(
      {
        "fab/outline.gko": diamond,
        "fab/top.gtl": traceGerber({ x: 0.5, y: 5 }, { x: 5, y: 9.5 }),
      },
      configuredLimit(0.3),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.details?.measuredClearanceMm).toBeCloseTo(0.254, 3);
    expect(finding?.details).toMatchObject({ featureKind: "trace", blocking: true });
  });

  it("does not turn a declared non-copper generic Gerber into blocking copper", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/mystery.gbr": traceGerber({ x: 0.05, y: 1 }, { x: 0.05, y: 9 }, 0.2, { fileFunction: "Soldermask,Top" }),
      },
      configuredLimit(),
    );

    expect(expectRule(result, "manufacturing.board-edge-clearance", 0)).toEqual([]);
  });

  it("keeps filename-only copper identity advisory even with an explicit limit", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }, 0.2, { declared: false }),
      },
      configuredLimit(),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.severity).toBe("low");
    expect(finding?.confidence).toBe("low");
    expect(finding?.details).toMatchObject({
      measuredClearanceMm: 0.15,
      limitSource: "configured",
      layerRoleEvidence: "assumed",
      configuredSeverity: "medium",
      severityCapped: true,
      blocking: false,
    });
    expect(finding?.details?.blockingRationale).toContain("filename");
  });

  it("keeps an unverified vendor-profile limit advisory even with exact geometry", async () => {
    const vendorConfig = `version: 1
vendor:
  profile: jlcpcb
rules:
  manufacturing.board-edge-clearance:
    enabled: true
fail-on: never
`;
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }),
      },
      vendorConfig,
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.severity).toBe("low");
    expect(finding?.confidence).toBe("low");
    expect(finding?.details).toMatchObject({
      measuredClearanceMm: 0.15,
      limitSource: "vendor-profile",
      profileAssurance: "unverified",
      profileMayBlock: false,
      severityCapped: true,
      blocking: false,
    });
  });

  it("does not report a clean board when copper arc interpolation is unmodelled", async () => {
    const curvedCopper = [
      ...header,
      "%TF.FileFunction,Copper,L1,Top*%",
      "%ADD10C,0.2*%",
      "D10*",
      position({ x: 5, y: 5 }, "D02"),
      position({ x: 5, y: 6 }, "D01"),
      "G02*",
      "X100000Y600000I250000J0D01*",
      "G01*",
      "M02*",
    ].join("\n");
    const result = await run({ "fab/outline.gko": squareOutline, "fab/top.gtl": curvedCopper }, configuredLimit());
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.confidence).toBe("low");
    expect(issue?.severity).toBe("low");
    expect(issue?.details).toMatchObject({
      blocking: false,
      geometryConfidence: "partial",
      severityCapped: true,
    });
    expect(issue?.details?.geometryUncertainty).toContain("copper:unsupported-interpolation");
  });

  it("does not trust an outline containing unsupported arc interpolation", async () => {
    const curvedOutline = [
      ...header,
      "%TF.FileFunction,Profile,NP*%",
      "%ADD10C,0.01*%",
      "D10*",
      position({ x: 0, y: 0 }, "D02"),
      position({ x: 10, y: 0 }, "D01"),
      "G03*",
      "X1000000Y1000000I0J500000D01*",
      "G01*",
      position({ x: 0, y: 10 }, "D01"),
      position({ x: 0, y: 0 }, "D01"),
      "M02*",
    ].join("\n");
    const result = await run(
      {
        "fab/outline.gko": curvedOutline,
        "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }),
      },
      configuredLimit(),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details?.blocking).toBe(false);
    expect(issue?.severity).toBe("low");
    expect(issue?.confidence).toBe("low");
    expect(issue?.details?.geometryConfidence).not.toBe("exact");
  });

  it.each([
    ["rectangle", "%ADD10R,0.6X0.2*%"],
    ["horizontal obround", "%ADD10O,0.6X0.2*%"],
    ["vertical obround", "%ADD10O,0.2X0.6*%"],
    ["regular polygon", "%ADD10P,0.6X6X0*%"],
    ["rotated triangle", "%ADD10P,0.6X3X30*%"],
  ])("measures a %s flash from copper extent, not the nominal centre", async (_name, aperture) => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": flashWithAperture({ x: 0.4, y: 5 }, aperture),
      },
      configuredLimit(0.4),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({
      featureKind: "flash",
      blocking: true,
      geometryConfidence: "exact",
    });
    expect(Number(issue?.details?.measuredClearanceMm)).toBeGreaterThanOrEqual(0);
    expect(Number(issue?.details?.measuredClearanceMm)).toBeLessThan(0.4);
  });

  it.each([
    ["rectangle", "%ADD10R,0.6X0.2*%"],
    ["horizontal obround", "%ADD10O,0.6X0.2*%"],
    ["vertical obround", "%ADD10O,0.2X0.6*%"],
    ["regular polygon", "%ADD10P,0.6X6X0*%"],
    ["rotated triangle", "%ADD10P,0.6X3X30*%"],
  ])("measures a swept %s trace using the full aperture", async (_name, aperture) => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.4, y: 2 }, { x: 0.4, y: 8 }, 0.2, { aperture }),
      },
      configuredLimit(0.4),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({ featureKind: "trace", blocking: true, geometryConfidence: "exact" });
    expect(Number(issue?.details?.measuredClearanceMm)).toBeGreaterThanOrEqual(0);
    expect(Number(issue?.details?.measuredClearanceMm)).toBeLessThan(0.4);
  });

  it("keeps undefined trace/flash aperture extents advisory instead of declaring a pass", async () => {
    for (const kind of ["trace", "flash"] as const) {
      const gerber =
        kind === "trace"
          ? traceGerber({ x: 0.3, y: 2 }, { x: 0.3, y: 8 }, 0.2, { aperture: "%ADD11C,0.2*%" })
          : flashWithAperture({ x: 0.3, y: 5 }, "%ADD11C,0.2*%");
      const result = await run({ "fab/outline.gko": squareOutline, "fab/top.gtl": gerber }, configuredLimit(0.4));
      const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
      expect(issue?.confidence).toBe("low");
      expect(issue?.details).toMatchObject({ blocking: false, geometryConfidence: "partial" });
      expect(String(issue?.message)).toContain("Cannot fully verify");
    }
  });

  it("advises rather than inventing an edge when the Gerber package lacks an outline", async () => {
    const result = await run({ "fab/top.gtl": traceGerber({ x: 0.2, y: 2 }, { x: 0.2, y: 8 }) }, configuredLimit(0.4));
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.severity).toBe("low");
    expect(issue?.details).toMatchObject({ blocking: false, geometryConfidence: "unknown" });
  });

  it("never blocks against a filename-inferred board profile", async () => {
    const outline = outlineGerber(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      false,
    );
    const result = await run(
      { "fab/outline.gko": outline, "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }) },
      configuredLimit(),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({ blocking: false, outlineRoleEvidence: "assumed" });
    expect(issue?.confidence).toBe("low");
  });

  it("does not trust outline files that mix a closed profile with flashed geometry", async () => {
    const outline = squareOutline.replace("M02*", [position({ x: 5, y: 5 }, "D03"), "M02*"].join("\n"));
    const result = await run(
      { "fab/outline.gko": outline, "fab/top.gtl": traceGerber({ x: 0.25, y: 2 }, { x: 0.25, y: 8 }) },
      configuredLimit(),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({ blocking: false, geometryConfidence: "partial" });
  });

  it("detects the board perimeter immersed inside a copper region", async () => {
    const spanning = regionGerber([
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ]);
    const result = await run({ "fab/outline.gko": squareOutline, "fab/top.gtl": spanning }, configuredLimit());
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({
      blocking: true,
      featureKind: "region",
      measuredClearanceMm: 0,
      featureLocation: { relation: "board-edge-inside-region" },
    });
  });

  it("never treats incomplete copper region geometry as exact clearance", async () => {
    const broken = [
      ...header,
      "%TF.FileFunction,Copper,L1,Top*%",
      "G36*",
      position({ x: 0.3, y: 2 }, "D02"),
      position({ x: 1, y: 2 }, "D01"),
      position({ x: 1, y: 4 }, "D01"),
      position({ x: 0.3, y: 4 }, "D02"),
      position({ x: 0.3, y: 6 }, "D01"),
      "G37*",
      "M02*",
    ].join("\n");
    const result = await run({ "fab/outline.gko": squareOutline, "fab/top.gtl": broken }, configuredLimit(0.4));
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({ blocking: false, geometryConfidence: "partial" });
  });

  it("measures circular obround copper without discarding the aperture radius", async () => {
    const result = await run(
      { "fab/outline.gko": squareOutline, "fab/top.gtl": flashWithAperture({ x: 0.3, y: 5 }, "%ADD10O,0.4X0.4*%") },
      configuredLimit(0.2),
    );
    const issue = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(issue?.details).toMatchObject({
      featureKind: "flash",
      blocking: true,
      measuredClearanceMm: 0.1,
      geometryConfidence: "exact",
    });
  });

  it("never turns incomplete transformed geometry into an exact blocking verdict", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.25, y: 1 }, { x: 0.25, y: 9 }, 0.2, { transform: "%LR90*%" }),
      },
      configuredLimit(),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.severity).toBe("low");
    expect(finding?.confidence).toBe("low");
    expect(finding?.details).toMatchObject({
      geometryConfidence: "partial",
      blocking: false,
      severityCapped: true,
    });
    expect(finding?.details?.geometryUncertainty).toContain("copper:object-transform");
  });

  it("passes complete measured copper that stays outside the configured clearance", async () => {
    const result = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.5, y: 1 }, { x: 0.5, y: 9 }),
      },
      configuredLimit(),
    );

    expect(expectRule(result, "manufacturing.board-edge-clearance", 0)).toEqual([]);
  });

  it("reports an open board profile as advisory instead of manufacturing a distance", async () => {
    const openOutline = [
      ...header,
      "%TF.FileFunction,Profile,NP*%",
      "%ADD10C,0.01*%",
      "D10*",
      position({ x: 0, y: 0 }, "D02"),
      position({ x: 10, y: 0 }, "D01"),
      "M02*",
    ].join("\n");

    const result = await run(
      {
        "fab/outline.gko": openOutline,
        "fab/top.gtl": traceGerber({ x: 1, y: 1 }, { x: 1, y: 9 }),
      },
      configuredLimit(),
    );

    const finding = expectRule(result, "manufacturing.board-edge-clearance", 1)[0];
    expect(finding?.severity).toBe("low");
    expect(finding?.confidence).toBe("low");
    expect(finding?.message).toContain("outline is missing or open");
    expect(finding?.details).toMatchObject({
      blocking: false,
      outlineClosed: false,
      geometryConfidence: "unknown",
      severityCapped: true,
    });
  });

  it("returns no findings when the rule is disabled or no Gerbers exist", async () => {
    const disabledConfig =
      "version: 1\nrules:\n  manufacturing.board-edge-clearance:\n    enabled: false\nfail-on: never\n";
    const disabled = await run(
      {
        "fab/outline.gko": squareOutline,
        "fab/top.gtl": traceGerber({ x: 0.1, y: 1 }, { x: 0.1, y: 9 }),
      },
      disabledConfig,
    );
    expect(expectRule(disabled, "manufacturing.board-edge-clearance", 0)).toEqual([]);

    const noGerbers = await run({});
    expect(expectRule(noGerbers, "manufacturing.board-edge-clearance", 0)).toEqual([]);
  });
});
