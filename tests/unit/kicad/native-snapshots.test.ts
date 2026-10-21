import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectKicadCli } from "../../../src/kicad/cli.js";
import { exportNativeKicadSnapshots, normalizeKicadSvg } from "../../../src/kicad/native-snapshots.js";
import { generateSnapshots } from "../../../src/kicad/snapshots.js";

const pcbFile = path.resolve("examples/golden-demo/fixed/demo.kicad_pcb");
const schFile = path.resolve("tests/fixtures/projects/hierarchical-schematic/safe-basic.kicad_sch");
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

describe("native SVG boundary", () => {
  it("strips an external DTD and keeps exact KiCad viewBox dimensions", () => {
    const raw =
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg viewBox="0 0 320.5 200.25"><path /></svg>';
    expect(normalizeKicadSvg(raw)).toMatchObject({ width: 320.5, height: 200.25 });
    expect(normalizeKicadSvg(raw)?.svg).not.toContain("<!DOCTYPE");
  });

  it.each([
    '<svg viewBox="0 0 3 4"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 3 4"><image href="https://invalid.example/resource" /></svg>',
    '<svg viewBox="0 0 3 4" onload="alert(1)"></svg>',
    '<svg viewBox="0 0 3 4"><foreignObject /></svg>',
    '<svg viewBox="0 0 0 4"></svg>',
  ])("rejects active, remote or malformed output", (svg) => {
    expect(normalizeKicadSvg(svg)).toBeUndefined();
  });
});

const cli = await detectKicadCli();
describe.skipIf(!cli.found || !cli.path)("real local KiCad CLI native renders", () => {
  it("renders genuine PCB copper without fake finding coordinates or source modification", async () => {
    const before = hash(await fs.readFile(pcbFile));
    const images = await exportNativeKicadSnapshots(cli.path ?? "", pcbFile, "pcb_layer", ["F.Cu"]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ kind: "pcb_layer", format: "svg", anchors: [] });
    expect(images[0]?.name).toMatch(/^kicad_native_/u);
    expect(images[0]?.content).toContain("<svg");
    expect(images[0]?.content).not.toContain("<!DOCTYPE");
    expect(images[0]?.sha256).toBe(hash(images[0]?.content ?? ""));
    expect(Number.isInteger(images[0]?.width)).toBe(true);
    expect(Number.isInteger(images[0]?.height)).toBe(true);
    expect(hash(await fs.readFile(pcbFile))).toBe(before);
  });

  it("renders a valid KiCad schematic and keeps its source unchanged", async () => {
    const before = hash(await fs.readFile(schFile));
    const images = await exportNativeKicadSnapshots(cli.path ?? "", schFile, "schematic");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatchObject({ kind: "schematic", format: "svg", anchors: [] });
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      expect(Number.isInteger(image.width)).toBe(true);
      expect(Number.isInteger(image.height)).toBe(true);
    }
    expect(hash(await fs.readFile(schFile))).toBe(before);
  });

  it("prefers native artwork while allowing the legacy summary explicitly", async () => {
    const native = await generateSnapshots({ pcbFiles: [pcbFile], nativeCli: cli.path ?? "" });
    const summary = await generateSnapshots({ pcbFiles: [pcbFile], nativeCli: false });
    expect(native[0]?.name).toMatch(/^kicad_native_/u);
    expect(summary[0]?.name).not.toMatch(/^kicad_native_/u);
  });
});
