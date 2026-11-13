import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SnapshotArtifact, SnapshotFinding } from "@boardreadyops/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { verifiedNativePcbItemAnchors } from "../../../src/kicad/native-snapshots.js";
import { parseKicadDiagnostics } from "../../../src/kicad/parsers/drc-report.js";
import { parsePcb } from "../../../src/kicad/pcb.js";

const bounds = { minX: 135.255, minY: 92.075, maxX: 160.655, maxY: 117.475 };
const plot: SnapshotArtifact = {
  id: "native-f-cu",
  name: "kicad_native_board_F.Cu.svg",
  kind: "pcb_layer",
  format: "svg",
  sheetOrLayer: "board / F.Cu",
  width: 26,
  height: 26,
  content: '<svg viewBox="0 0 25.4 25.4"></svg>',
  sha256: "a".repeat(64),
  anchors: [],
};
const sourceUUID = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const violation = {
  type: "hole_clearance",
  severity: "error",
  description: "Hole clearance violation",
  items: [
    {
      description: "Zone [GND] on F.Cu and B.Cu",
      pos: { x: 160.655, y: 117.475 },
      uuid: "aff3a1d9-acf5-4fca-8f70-1b96e78bc30b",
    },
    { description: "Pad 2 [GND] of SW2 on F.Cu", pos: { x: 145.621548, y: 107.108452 }, uuid: sourceUUID },
  ],
};
function findings(units: string): SnapshotFinding[] {
  const source = parseKicadDiagnostics(JSON.stringify({ coordinate_units: units, violations: [violation] }), "drc");
  return [
    {
      fingerprint: "f".repeat(64),
      ruleId: "drc.hole_clearance",
      severity: "error",
      message: source[0]?.message ?? "",
      details: source[0]?.raw,
    },
  ];
}
describe("Source-bound KiCad DRC object markers", () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.map((p) => fs.rm(p, { recursive: true, force: true })));
    temporary.length = 0;
  });
  it("projects a real reported F.Cu pad position through a matching rectangular outline only", () => {
    const anchors = verifiedNativePcbItemAnchors(plot, bounds, findings("mm"));
    expect(anchors).toHaveLength(1);
    const found = anchors[0];
    expect(found).toMatchObject({
      kind: "finding",
      targetRef: "SW2",
      layer: "F.Cu",
      metadata: {
        provenance: "kicad-json-object-position",
        sourceUuid: sourceUUID,
        sourceXmm: 145.621548,
        sourceYmm: 107.108452,
        fingerprint: "f".repeat(64),
        locationMeaning: "Referenced source object, not verified violation center",
      },
    });
    expect(found?.x).toBeCloseTo((145.621548 - 135.255) / 25.4, 6);
    expect(found?.y).toBeCloseTo((107.108452 - 92.075) / 25.4, 6);
    // Multi-layer zones and arbitrary midpoints must NOT generate markers.
    expect(anchors.map((a) => a.targetRef)).toEqual(["SW2"]);
  });
  it("maps only KiCad-reported B.Cu objects into the actual native B.Cu view", () => {
    const back = { ...plot, name: "kicad_native_board_B.Cu.svg", sheetOrLayer: "board / B.Cu" };
    const sourceFinding = findings("mm")[0];
    if (!sourceFinding) throw new Error("Expected diagnostic");
    const pad = {
      description: "Pad 1 [3.3V] of D2 on B.Cu",
      uuid: "c71b2196-ae56-4853-92ac-5497683704cd",
      pos: { x: 138.785, y: 99.9275 },
    };
    const finding = { ...sourceFinding, details: { coordinate_units: "mm", items: [pad] } };
    const anchors = verifiedNativePcbItemAnchors(back, bounds, [finding]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      targetRef: "D2",
      layer: "B.Cu",
      metadata: { sourceUuid: pad.uuid, locationMeaning: "Referenced source object, not verified violation center" },
    });
    expect(anchors[0]?.x).toBeCloseTo((138.785 - bounds.minX) / 25.4, 6);
    expect(anchors[0]?.y).toBeCloseTo((99.9275 - bounds.minY) / 25.4, 6);
    expect(verifiedNativePcbItemAnchors(plot, bounds, [finding])).toEqual([]);
  });

  it("maps a real KiCad 10 track object despite SVG plot rounding and length suffix", () => {
    // Captured with KiCad CLI 10.0.7 DRC --format json --units mm.
    const parsed = parseKicadDiagnostics(
      JSON.stringify({
        coordinate_units: "mm",
        violations: [
          {
            type: "track_dangling",
            severity: "warning",
            description: "Track has unconnected end",
            items: [
              {
                description: "Track [NET_A] on F.Cu, length 6.0000 mm",
                pos: { x: 2, y: 2 },
                uuid: "f18bfa9e-fd9d-4b93-bbf4-347b5f9b065d",
              },
            ],
          },
        ],
      }),
      "drc",
    );
    const finding: SnapshotFinding = {
      fingerprint: "a".repeat(64),
      ruleId: `drc.${parsed[0]?.ruleId}`,
      severity: "medium",
      message: parsed[0]?.message ?? "",
      details: parsed[0]?.raw,
    };
    const native = { ...plot, content: '<svg viewBox="0 0 9.9822 9.9822"></svg>' };
    const origin = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(verifiedNativePcbItemAnchors(native, origin, [finding])).toMatchObject([
      {
        kind: "finding",
        targetRef: "Track",
        x: 0.2,
        y: 0.2,
        metadata: {
          sourceUuid: "f18bfa9e-fd9d-4b93-bbf4-347b5f9b065d",
          locationMeaning: "Referenced source object, not verified violation center",
        },
      },
    ]);
    const genericItem = {
      description: "Graphic on F.Cu",
      uuid: "fb7a6d1c-fc23-48bc-b260-e95fb8116acc",
      pos: { x: 3, y: 3 },
    };
    expect(
      verifiedNativePcbItemAnchors(native, origin, [
        { ...finding, details: { coordinate_units: "mm", items: [genericItem] } },
      ]),
    ).toMatchObject([{ targetRef: "Item", x: 0.3, y: 0.3 }]);
    expect(
      verifiedNativePcbItemAnchors(native, origin, [
        { ...finding, details: { coordinate_units: "mm", items: [{ ...genericItem, description: 42 }] } },
      ]),
    ).toEqual([]);
    expect(
      verifiedNativePcbItemAnchors({ ...native, content: '<svg viewBox="0 0 9.94 9.9822"></svg>' }, origin, [finding]),
    ).toEqual([]);
  });

  it("fails closed when source units, plot geometry, layer, or item provenance differ", () => {
    expect(verifiedNativePcbItemAnchors(plot, bounds, findings("mil"))).toEqual([]);
    expect(verifiedNativePcbItemAnchors({ ...plot, kind: "schematic" }, bounds, findings("mm"))).toEqual([]);
    expect(verifiedNativePcbItemAnchors({ ...plot, sheetOrLayer: "board / B.Cu" }, bounds, findings("mm"))).toEqual([]);
    expect(
      verifiedNativePcbItemAnchors({ ...plot, content: '<svg viewBox="1 0 25.4 25.4"></svg>' }, bounds, findings("mm")),
    ).toEqual([]);
    expect(
      verifiedNativePcbItemAnchors({ ...plot, content: '<svg viewBox="0 0 26.4 25.4"></svg>' }, bounds, findings("mm")),
    ).toEqual([]);
    const sourceFinding = findings("mm")[0];
    if (!sourceFinding) throw new Error("Expected KiCad DRC diagnostic");
    expect(verifiedNativePcbItemAnchors(plot, bounds, [{ ...sourceFinding, ruleId: "bom.missing-mpn" }])).toEqual([]);
  });
  it("maps an exact 4-line, 4-quarter-arc rounded outline from an actual KiCad PCB layout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bro-native-rounded-bounds-"));
    temporary.push(root);
    const pcb = path.join(root, "rounded.kicad_pcb");
    const layers = '(layers (0 "F.Cu" signal) (31 "B.Cu" signal))';
    const segments = [
      '(gr_line (start 121.64 93.55) (end 174.98 93.55) (layer "Edge.Cuts"))',
      '(gr_line (start 177.52 96.09) (end 177.52 113.87) (layer "Edge.Cuts"))',
      '(gr_line (start 174.98 116.41) (end 121.64 116.41) (layer "Edge.Cuts"))',
      '(gr_line (start 119.1 113.87) (end 119.1 96.09) (layer "Edge.Cuts"))',
      '(gr_arc (start 174.98 93.55) (mid 176.776051 94.293949) (end 177.52 96.09) (layer "Edge.Cuts"))',
      '(gr_arc (start 177.52 113.87) (mid 176.776051 115.666051) (end 174.98 116.41) (layer "Edge.Cuts"))',
      '(gr_arc (start 121.64 116.41) (mid 119.843949 115.666051) (end 119.1 113.87) (layer "Edge.Cuts"))',
      '(gr_arc (start 119.1 96.09) (mid 119.843949 94.293949) (end 121.64 93.55) (layer "Edge.Cuts"))',
    ];
    const write = async (parts: string[]) => {
      await fs.writeFile(pcb, `(kicad_pcb (version 20240108) ${layers} ${parts.join(" ")})`);
      return (await parsePcb(pcb)).outlineBounds;
    };
    const actual = { minX: 119.1, minY: 93.55, maxX: 177.52, maxY: 116.41 };
    expect(await write(segments)).toEqual(actual);
    // Actual KiCad 10 --fit-page-to-board SVG for these same dimensions.
    const native = {
      ...plot,
      content: '<svg viewBox="0.0000 0.0000 58.4200 22.8600"></svg>',
    };
    const finding: SnapshotFinding = {
      fingerprint: "e".repeat(64),
      ruleId: "drc.hole_clearance",
      severity: "high",
      message: "Hole clearance",
      details: {
        coordinate_units: "mm",
        items: [
          {
            description: "Track [/Debugger/USB.VBUS] on B.Cu, length 1.5150 mm",
            pos: { x: 123.67, y: 102.75 },
            uuid: "5d98b95c-d01d-4e88-8c2c-83c62e48cb07",
          },
        ],
      },
    };
    const anchors = verifiedNativePcbItemAnchors({ ...native, sheetOrLayer: "rounded / B.Cu" }, actual, [finding]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      layer: "B.Cu",
      metadata: { provenance: "kicad-json-object-position", sourceXmm: 123.67, sourceYmm: 102.75 },
    });
    expect(anchors[0]?.x).toBeCloseTo((123.67 - 119.1) / 58.42, 6);
    expect(anchors[0]?.y).toBeCloseTo((102.75 - 93.55) / 22.86, 6);

    // A wrong radius, arc midpoint, disconnected line or a second cutout
    // must not be rendered as a confidently located DRC marker.
    expect(
      await write(segments.map((part, i) => (i === 4 ? part.replace("176.776051", "176.1") : part))),
    ).toBeUndefined();
    expect(
      await write(segments.map((part, i) => (i === 4 ? part.replace("177.52 96.09", "177.3 96.09") : part))),
    ).toBeUndefined();
    expect(
      await write([...segments, '(gr_circle (center 145 100) (end 146 100) (layer "Edge.Cuts"))']),
    ).toBeUndefined();
    expect(
      await write(segments.map((part, i) => (i === 4 ? part.replace("174.98 93.55", "121.64 93.55") : part))),
    ).toBeUndefined();
  });

  it("recognizes only a single source-declared rectangular Edge.Cuts outline", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bro-native-bounds-"));
    temporary.push(root);
    const file = path.join(root, "board.kicad_pcb");
    const rectangle = '(gr_rect (start 135.255 92.075) (end 160.655 117.475) (stroke (width 0.1)) (layer "Edge.Cuts"))';
    const layerDefinitions = '(layers (0 "F.Cu" signal) (31 "B.Cu" jumper))';
    await fs.writeFile(file, `(kicad_pcb (version 20240108) ${layerDefinitions} ${rectangle})`);
    const parsed = await parsePcb(file);
    expect(parsed.outlineBounds).toEqual(bounds);
    expect(parsed.copperLayers).toEqual(["F.Cu"]);
    expect(parsed.plotCopperLayers).toEqual(["F.Cu", "B.Cu"]);
    await fs.writeFile(
      file,
      `(kicad_pcb (version 20240108) ${rectangle} (gr_line (start 1 2) (end 3 4) (layer "Edge.Cuts")))`,
    );
    expect((await parsePcb(file)).outlineBounds).toBeUndefined();
  });
});
