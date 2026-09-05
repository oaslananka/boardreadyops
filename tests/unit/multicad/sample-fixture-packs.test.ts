import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBomAndCentroid } from "../../../src/multicad/bom-centroid-parser.js";
import { detectPackageFormat } from "../../../src/multicad/detector.js";
import { normalizeGerberStackup } from "../../../src/multicad/gerber-normalizer.js";

const FIXTURES_BASE = "tests/fixtures/multicad";

async function listRelativeFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullRel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(join(dir, entry.name), fullRel)));
    } else {
      files.push(fullRel);
    }
  }
  return files;
}

describe("Multi-CAD Sample Fixture Packs Ingestion & Verification", () => {
  it("1. Verifies KiCad ESP32-S3 IoT Gateway fixture", async () => {
    const dir = join(FIXTURES_BASE, "kicad-esp32");
    const fileList = await listRelativeFiles(dir);

    const detection = await detectPackageFormat(fileList, (f) => readFile(join(dir, f), "utf8"));
    expect(detection.format).toBe("kicad");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.9);

    const bomContent = await readFile(join(dir, "bom.csv"), "utf8");
    const cplContent = await readFile(join(dir, "pick_and_place.csv"), "utf8");
    const components = parseBomAndCentroid(bomContent, cplContent, "bom.csv");

    expect(components.length).toBe(3);
    const u1 = components.find((c) => c.refDes === "U1");
    expect(u1).toBeDefined();
    expect(u1?.mpn).toBe("ESP32-S3-WROOM-1-N8R8");
    expect(u1?.side).toBe("top");
    expect(u1?.xMm).toBeCloseTo(25.4);
  });

  it("2. Verifies Altium Designer STM32 Motor Controller fixture", async () => {
    const dir = join(FIXTURES_BASE, "altium-stm32");
    const fileList = await listRelativeFiles(dir);

    const detection = await detectPackageFormat(fileList, (f) => readFile(join(dir, f), "utf8"));
    expect(detection.format).toBe("altium");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.85);

    // Verify Gerber stackup normalization
    const stackup = normalizeGerberStackup(fileList.map((filename) => ({ filename })));
    const topCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "top");
    const bottomCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "bottom");
    const outline = stackup.layers.find((l) => l.role === "outline");

    expect(topCopper).toBeDefined();
    expect(bottomCopper).toBeDefined();
    expect(outline).toBeDefined();

    const bomContent = await readFile(join(dir, "bom.csv"), "utf8");
    const cplContent = await readFile(join(dir, "pick_and_place.csv"), "utf8");
    const components = parseBomAndCentroid(bomContent, cplContent, "bom.csv");

    expect(components.length).toBe(3);
    const u1 = components.find((c) => c.refDes === "U1");
    expect(u1).toBeDefined();
    expect(u1?.mpn).toBe("STM32F401RET6");
    expect(u1?.side).toBe("top");
    expect(u1?.xMm).toBeCloseTo(25.4);
  });

  it("3. Verifies EasyEDA Pro RP2040 Sensor Node fixture", async () => {
    const dir = join(FIXTURES_BASE, "easyeda-rp2040");
    const fileList = await listRelativeFiles(dir);

    const detection = await detectPackageFormat(fileList, (f) => readFile(join(dir, f), "utf8"));
    expect(detection.format).toBe("easyeda");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.85);

    const stackup = normalizeGerberStackup(fileList.map((filename) => ({ filename })));
    const topCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "top");
    const bottomCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "bottom");
    const outline = stackup.layers.find((l) => l.role === "outline");

    expect(topCopper).toBeDefined();
    expect(bottomCopper).toBeDefined();
    expect(outline).toBeDefined();

    const bomContent = await readFile(join(dir, "BOM.csv"), "utf8");
    const cplContent = await readFile(join(dir, "PickAndPlace.csv"), "utf8");
    const components = parseBomAndCentroid(bomContent, cplContent, "BOM.csv");

    expect(components.length).toBe(3);
    const u1 = components.find((c) => c.refDes === "U1");
    expect(u1).toBeDefined();
    expect(u1?.mpn).toBe("RP2040");
    expect(u1?.side).toBe("top");
    expect(u1?.xMm).toBeCloseTo(20.0);
  });

  it("4. Verifies Autodesk Fusion Electronics BLE Wearable fixture", async () => {
    const dir = join(FIXTURES_BASE, "fusion-ble");
    const fileList = await listRelativeFiles(dir);

    const detection = await detectPackageFormat(fileList, (f) => readFile(join(dir, f), "utf8"));
    expect(detection.format).toBe("fusion360");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.85);

    const stackup = normalizeGerberStackup(fileList.map((filename) => ({ filename })));
    const topCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "top");
    const bottomCopper = stackup.layers.find((l) => l.role === "copper" && l.side === "bottom");

    expect(topCopper).toBeDefined();
    expect(bottomCopper).toBeDefined();

    const bomContent = await readFile(join(dir, "CAMOutputs/Assembly/bom.csv"), "utf8");
    const cplContent = await readFile(join(dir, "CAMOutputs/Assembly/mountsmd.mnt"), "utf8");
    const components = parseBomAndCentroid(bomContent, cplContent, "bom.csv");

    expect(components.length).toBe(3);
    const u1 = components.find((c) => c.refDes === "U1");
    expect(u1).toBeDefined();
    expect(u1?.mpn).toBe("nRF52840-QIAA-R");
    expect(u1?.xMm).toBeCloseTo(15.0);
  });
});
