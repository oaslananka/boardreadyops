import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportNativeKicadSnapshots, normalizeKicadSvg } from "../../../src/kicad/native-snapshots.js";
import { runProcess } from "../../../src/util/process.js";

vi.mock("../../../src/util/process.js", () => ({ runProcess: vi.fn() }));
const mockProcess = vi.mocked(runProcess);
const VALID = '<svg viewBox="0 0 20 30"><path d="M1 1"/></svg>';
const result = { code: 0, stdout: "", stderr: "", timedOut: false };
let root = "";
let original = "";

function successfulPlot(): void {
  mockProcess.mockImplementation(async (_command, args) => {
    const output = args[args.indexOf("--output") + 1];
    if (!output) throw new Error("output missing");
    if (args[0] === "sch") {
      await fs.writeFile(path.join(output, "z.svg"), VALID);
      await fs.writeFile(path.join(output, "a.svg"), VALID);
      await fs.writeFile(path.join(output, "noise.txt"), "unrelated");
    } else {
      await fs.writeFile(output, VALID);
    }
    return result;
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-native-test-"));
  original = path.join(root, "alpha.kicad_pcb");
  await fs.writeFile(original, "unchanged source");
  vi.resetAllMocks();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("KiCad-native offline exporter without requiring installed KiCad", () => {
  it("rounds fractional native SVG dimensions for SQL while preserving exact artwork", async () => {
    const originalSvg = '<svg viewBox="0 0 279.4 115.6"><path d="M1 1"/></svg>';
    mockProcess.mockImplementation(async (_command, args) => {
      const output = args[args.indexOf("--output") + 1];
      if (!output) throw new Error("output missing");
      await fs.writeFile(output, originalSvg);
      return result;
    });
    const artwork = await exportNativeKicadSnapshots("fake-kicad-cli", original, "pcb_layer", ["F.Cu"]);
    expect(artwork).toHaveLength(1);
    expect(artwork[0]).toMatchObject({ width: 280, height: 116 });
    expect(artwork[0]?.content).toContain('viewBox="0 0 279.4 115.6"');
  });

  it("uses temporary source copies, keeps the original clean, supports native PCB layers and stable IDs", async () => {
    successfulPlot();
    const art = await exportNativeKicadSnapshots("fake-kicad-cli", original, "pcb_layer", [
      "F.Cu",
      "B.Cu",
      "In3.Cu",
      "bad.layer",
      "F.Cu",
    ]);
    expect(art).toHaveLength(3);
    expect(art.map((v) => v.sheetOrLayer)).toEqual(["alpha / F.Cu", "alpha / B.Cu", "alpha / In3.Cu"]);
    expect(art.every((a) => a.anchors.length === 0 && a.name.startsWith("kicad_native_"))).toBe(true);
    expect(await fs.readFile(original, "utf8")).toBe("unchanged source");
    expect(mockProcess).toHaveBeenCalledTimes(3);
    const call = mockProcess.mock.calls[0];
    expect(call?.[1]).toContain("F.Cu,F.SilkS,Edge.Cuts");
    expect(call?.[1].at(-1)).not.toBe(original);
    expect(await exportNativeKicadSnapshots("fake-kicad-cli", original, "pcb_layer", ["F.Cu"])).toMatchObject([
      { id: art[0]?.id },
    ]);
  });

  it("keeps only valid published schematic SVG files sorted by sheet and ignores non-svg files", async () => {
    successfulPlot();
    const sch = path.join(root, "alpha.kicad_sch");
    await fs.writeFile(sch, "schematic");
    await fs.writeFile(path.join(root, "alpha.kicad_pro"), "{}");
    const art = await exportNativeKicadSnapshots("cli", sch, "schematic");
    expect(art).toHaveLength(2);
    expect(art.map((a) => a.sheetOrLayer)).toEqual(["alpha / a", "alpha / z"]);
    expect(art.every((a) => a.kind === "schematic")).toBe(true);
    expect(mockProcess.mock.calls[0]?.[1].at(-1)).not.toBe(sch);
    expect(await fs.readFile(sch, "utf8")).toBe("schematic");
  });

  it.each([
    { code: 1, timedOut: false },
    { code: null, timedOut: true },
  ])("rejects unsuccessful or timed-out exports", async ({ code, timedOut }) => {
    mockProcess.mockResolvedValue({ ...result, code, timedOut });
    expect(await exportNativeKicadSnapshots("cli", original, "pcb_layer", ["F.Cu"])).toEqual([]);
    expect(await exportNativeKicadSnapshots("cli", original, "schematic")).toEqual([]);
  });

  it("rejects missing output and invalid or oversized artwork", async () => {
    mockProcess.mockResolvedValue(result);
    expect(await exportNativeKicadSnapshots("cli", original, "pcb_layer", ["F.Cu"])).toEqual([]);
    mockProcess.mockImplementation(async (_cmd, args) => {
      const output = args[args.indexOf("--output") + 1] ?? "";
      await fs.writeFile(output, "<svg viewBox='0 0 5 6'><script /></svg>");
      return result;
    });
    expect(await exportNativeKicadSnapshots("cli", original, "pcb_layer", ["F.Cu"])).toEqual([]);
    mockProcess.mockImplementation(async (_cmd, args) => {
      const output = args[args.indexOf("--output") + 1] ?? "";
      await fs.writeFile(output, VALID + " ".repeat(2 * 1024 * 1024));
      return result;
    });
    expect(await exportNativeKicadSnapshots("cli", original, "pcb_layer", ["F.Cu"])).toEqual([]);
  });

  it("rejects a source changed during rendering", async () => {
    mockProcess.mockImplementation(async (_cmd, args) => {
      await fs.writeFile(args[args.indexOf("--output") + 1] ?? "", VALID);
      await fs.writeFile(original, "changed during export");
      return result;
    });
    expect(await exportNativeKicadSnapshots("cli", original, "pcb_layer", ["B.Cu"])).toEqual([]);
  });

  it("handles a missing original without starting KiCad", async () => {
    const missing = path.join(root, "does-not-exist.kicad_sch");
    expect(await exportNativeKicadSnapshots("cli", missing, "schematic")).toEqual([]);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("bounds snapshots to 16 layers and skips invalid layers", async () => {
    successfulPlot();
    const layers = Array.from({ length: 25 }, (_, i) => `In${i}.Cu`);
    const art = await exportNativeKicadSnapshots("cli", original, "pcb_layer", layers);
    expect(art).toHaveLength(16);
  });

  it("permits only locally referenced SVG href/fill URLs and rejects active or malformed output", () => {
    expect(normalizeKicadSvg('<svg viewBox="0 0 3 4"><use href="#safe" fill="url(#ok)"/></svg>')).toBeDefined();
    expect(
      normalizeKicadSvg('<svg viewBox="0 0 3 4"><use xlink:href="https://remote.example"/></svg>'),
    ).toBeUndefined();
    expect(
      normalizeKicadSvg('<svg viewBox="0 0 3 4"><rect fill="url(https://remote.example)"/></svg>'),
    ).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 3 4"><style>@import url(secret)</style></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 3 4"><animate/></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 3 4"><rect onmouseover="alert(1)"/></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 Infinity 4"></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 -3 4"></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg viewBox="0 0 4"></svg>')).toBeUndefined();
    expect(normalizeKicadSvg('<svg width="3" height="4"></svg>')).toBeUndefined();
    expect(normalizeKicadSvg("")).toBeUndefined();
    expect(
      normalizeKicadSvg(`<svg viewBox='0 0 3 4'><text>${"X".repeat(2 * 1024 * 1024)}</text></svg>`),
    ).toBeUndefined();
  });
});
