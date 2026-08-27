import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPcbLayerSvg,
  createSchematicSvg,
  generateSnapshots,
  linkFindingAnchors,
} from "../../../src/kicad/snapshots.js";
import { writeFixture } from "../rules/helpers.js";

describe("createSchematicSvg", () => {
  it("renders one anchor per component and lists visible nets", () => {
    const { svg, anchors } = createSchematicSvg(
      "Main",
      [
        { reference: "U1", value: "MCU", footprint: "Package:QFN" },
        { reference: "R1", value: "10k", footprint: "R_0402" },
      ],
      ["NET_A", "NET_B"],
    );

    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ kind: "component", targetRef: "U1", sheet: "Main" });
    expect(svg).toContain("Sheet: Main");
    expect(svg).toContain("NETS: NET_A • NET_B");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("escapes reference, value, and footprint text so untrusted KiCad content cannot break the markup", () => {
    const { svg } = createSchematicSvg(
      'Main"><script>alert(1)</script>',
      [{ reference: 'U1"><script>x</script>', value: "<img onerror=alert(1)>", footprint: "R&D" }],
      ['NET_A"><script>y</script>'],
    );

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;D");
    expect(svg).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("createPcbLayerSvg", () => {
  it("renders footprints on a layer and derives a grid layout without coordinates", () => {
    const { svg, anchors } = createPcbLayerSvg("F.Cu", [
      { reference: "U1", footprint: "Package:QFN", at: { x: 10, y: 20 } },
      { reference: "Q1", footprint: "SOT23" },
    ]);

    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ kind: "component", targetRef: "U1", layer: "F.Cu" });
    expect(svg).toContain("Layer: F.Cu");
  });

  it("escapes the layer name and footprint reference", () => {
    const { svg } = createPcbLayerSvg('F.Cu"><script>alert(1)</script>', [
      { reference: 'Q1"><script>z</script>', footprint: "SOT23" },
    ]);

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("linkFindingAnchors", () => {
  it("attaches a finding anchor to the matching component anchor", () => {
    const { anchors } = createSchematicSvg("Main", [{ reference: "U1" }], []);
    const linked = linkFindingAnchors(anchors, [
      { fingerprint: "fp1", ruleId: "erc.unrouted", severity: "high", message: "U1 pin unrouted" },
    ]);

    const findingAnchor = linked.find((a) => a.kind === "finding");
    expect(findingAnchor).toMatchObject({ targetRef: "U1", metadata: { fingerprint: "fp1", ruleId: "erc.unrouted" } });
  });

  it("prefers an explicit component reference in finding details over message text", () => {
    const { anchors } = createSchematicSvg("Main", [{ reference: "R2" }], []);
    const linked = linkFindingAnchors(anchors, [
      {
        fingerprint: "fp2",
        ruleId: "bom.missing-mpn",
        severity: "medium",
        message: "no reference in message",
        details: { component: "R2" },
      },
    ]);

    expect(linked.some((a) => a.kind === "finding" && a.targetRef === "R2")).toBe(true);
  });

  it("leaves anchors unchanged when a finding cannot be matched to any component", () => {
    const { anchors } = createSchematicSvg("Main", [{ reference: "U1" }], []);
    const linked = linkFindingAnchors(anchors, [
      { fingerprint: "fp3", ruleId: "design.unique-references", severity: "low", message: "no designator here" },
    ]);

    expect(linked).toEqual(anchors);
  });
});

describe("generateSnapshots", () => {
  it("produces schematic and per-layer PCB artifacts with stable sha256 digests", async () => {
    const root = await writeFixture({
      "board.kicad_sch": `(kicad_sch
        (symbol (property "Reference" "U1") (property "Value" "MCU") (property "Footprint" "Package:QFN"))
        (label "NET_A")
      )`,
      "board.kicad_pcb": `(kicad_pcb
        (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
        (footprint "Package:QFN" (layer "F.Cu") (property "Reference" "U1"))
      )`,
    });

    const artifacts = await generateSnapshots({
      schematicFiles: [path.join(root, "board.kicad_sch")],
      pcbFiles: [path.join(root, "board.kicad_pcb")],
      findings: [{ fingerprint: "fp1", ruleId: "erc.unrouted", severity: "high", message: "U1 issue" }],
    });

    expect(artifacts.length).toBeGreaterThanOrEqual(2);
    const schematic = artifacts.find((a) => a.kind === "schematic");
    expect(schematic).toMatchObject({ format: "svg", sheetOrLayer: "board" });
    expect(schematic?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(schematic?.anchors.some((a) => a.kind === "finding")).toBe(true);

    const pcbLayers = artifacts.filter((a) => a.kind === "pcb_layer");
    expect(pcbLayers.map((a) => a.sheetOrLayer).sort()).toEqual(["B.Cu", "F.Cu"]);
  });

  it("returns no artifacts when no schematic or PCB files are supplied", async () => {
    expect(await generateSnapshots({})).toEqual([]);
  });

  it("never throws for a malformed KiCad file, degrading to an empty-component render", async () => {
    const root = await writeFixture({ "broken.kicad_sch": "not a valid kicad file (((" });
    const artifacts = await generateSnapshots({ schematicFiles: [path.join(root, "broken.kicad_sch")] });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "schematic", anchors: [] });
  });
});
