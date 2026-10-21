import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectKicadCli } from "../../../src/kicad/cli.js";
import { exportNativeKicadSnapshots } from "../../../src/kicad/native-snapshots.js";
import { generateSnapshots } from "../../../src/kicad/snapshots.js";

vi.mock("../../../src/kicad/cli.js", () => ({ detectKicadCli: vi.fn() }));
vi.mock("../../../src/kicad/native-snapshots.js", () => ({ exportNativeKicadSnapshots: vi.fn() }));

const detect = vi.mocked(detectKicadCli);
const exportPlot = vi.mocked(exportNativeKicadSnapshots);
const pcb = path.resolve("examples/golden-demo/fixed/demo.kicad_pcb");
const sch = path.resolve("tests/fixtures/projects/hierarchical-schematic/safe-basic.kicad_sch");

const image = {
  id: "native-test",
  kind: "schematic" as const,
  name: "kicad_native_test.svg",
  format: "svg" as const,
  sheetOrLayer: "Test",
  width: 30,
  height: 20,
  sha256: "f".repeat(64),
  content: '<svg viewBox="0 0 30 20"></svg>',
  anchors: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  detect.mockResolvedValue({ found: true, path: "fake-kicad" });
  exportPlot.mockResolvedValue([image]);
});

describe("published Review prefers real artwork with lossless summary fallback", () => {
  it("uses the supplied binary path and emits native schematic and PCB images", async () => {
    const result = await generateSnapshots({ schematicFiles: [sch], pcbFiles: [pcb], nativeCli: "fake-kicad" });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.name.startsWith("kicad_native_"))).toBe(true);
    expect(detect).toHaveBeenCalledWith("fake-kicad");
    expect(exportPlot).toHaveBeenCalledWith("fake-kicad", sch, "schematic");
    expect(exportPlot).toHaveBeenCalledWith("fake-kicad", pcb, "pcb_layer", expect.any(Array));
  });

  it("defaults to summary snapshots when no native binary exists", async () => {
    detect.mockResolvedValue({ found: false });
    const result = await generateSnapshots({ pcbFiles: [pcb], schematicFiles: [sch] });
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((a) => !a.name.startsWith("kicad_native_"))).toBe(true);
    expect(exportPlot).not.toHaveBeenCalled();
  });

  it("honors explicit metadata-first disabling of native plotting", async () => {
    const result = await generateSnapshots({ pcbFiles: [pcb], nativeCli: false });
    expect(result.length).toBeGreaterThan(0);
    expect(detect).not.toHaveBeenCalled();
    expect(exportPlot).not.toHaveBeenCalled();
  });

  it("gracefully falls back if native PCB and schematic export fail or return empty", async () => {
    exportPlot.mockRejectedValueOnce(new Error("unavailable"));
    exportPlot.mockResolvedValueOnce([]);
    const result = await generateSnapshots({ pcbFiles: [pcb], schematicFiles: [sch] });
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((a) => !a.name.startsWith("kicad_native_"))).toBe(true);
  });

  it("limits the combined number of published snapshots to 64", async () => {
    const result = await generateSnapshots({ schematicFiles: Array(67).fill(sch) });
    expect(result).toHaveLength(64);
  });
});
