import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPackageFormat } from "../../../src/multicad/detector.js";
import { parseIpc2581Package } from "../../../src/multicad/ipc2581-parser.js";

const FIXTURE_PATH = join(__dirname, "../../fixtures/multicad/ipc2581-sensor/board.xml");

describe("IPC-2581 XML Ingestion & Normalization", () => {
  it("detects IPC-2581 XML file with high confidence", async () => {
    const fileList = ["board.xml"];
    const content = await readFile(FIXTURE_PATH, "utf8");

    const detection = await detectPackageFormat(fileList, async () => content);
    expect(detection.format).toBe("ipc2581");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.95);
    expect(detection.detectedVersion).toBe("B");
  });

  it("parses IPC-2581 XML fixture into NormalizedPcbPackage", async () => {
    const content = await readFile(FIXTURE_PATH, "utf8");
    const pkg = parseIpc2581Package(content, "board.xml");

    expect(pkg.format).toBe("ipc2581");
    expect(pkg.formatVersion).toBe("B");

    // Board dimensions
    expect(pkg.board.widthMm).toBeCloseTo(50.0);
    expect(pkg.board.heightMm).toBeCloseTo(40.0);

    // Capabilities
    expect(pkg.capabilities.hasNetlistConnectivity).toBe(true);
    expect(pkg.capabilities.hasBomMapping).toBe(true);
    expect(pkg.capabilities.hasCentroidPlacement).toBe(true);
    expect(pkg.capabilities.hasGerberOutlines).toBe(true);

    // Layer stackup
    expect(pkg.layers.length).toBeGreaterThanOrEqual(4);
    const topCopper = pkg.layers.find((l) => l.role === "copper" && l.side === "top");
    const bottomCopper = pkg.layers.find((l) => l.role === "copper" && l.side === "bottom");
    expect(topCopper).toBeDefined();
    expect(bottomCopper).toBeDefined();

    // Components & Centroids
    expect(pkg.components.length).toBe(2);

    const u1 = pkg.components.find((c) => c.refDes === "U1");
    expect(u1).toBeDefined();
    expect(u1?.value).toBe("STM32G030K6T6");
    expect(u1?.mpn).toBe("STM32G030K6T6");
    expect(u1?.footprint).toBe("LQFP32");
    expect(u1?.side).toBe("top");
    expect(u1?.xMm).toBeCloseTo(25.0);
    expect(u1?.yMm).toBeCloseTo(20.0);
    expect(u1?.rotationDegrees).toBe(0.0);

    const c1 = pkg.components.find((c) => c.refDes === "C1");
    expect(c1).toBeDefined();
    expect(c1?.value).toBe("100nF");
    expect(c1?.mpn).toBe("CL05B104KO5NNNC");
    expect(c1?.footprint).toBe("0402");
    expect(c1?.xMm).toBeCloseTo(20.0);
    expect(c1?.yMm).toBeCloseTo(15.0);
    expect(c1?.rotationDegrees).toBe(90.0);

    // Netlist connectivity
    expect(pkg.netlist).toBeDefined();
    expect(pkg.netlist?.GND).toContainEqual({ componentRef: "U1", pin: "16" });
    expect(pkg.netlist?.GND).toContainEqual({ componentRef: "C1", pin: "2" });
    expect(pkg.netlist?.["+3V3"]).toContainEqual({ componentRef: "U1", pin: "1" });
  });

  it("converts imperial units (INCH) to millimeters accurately", () => {
    const inchXml = `<?xml version="1.0"?>
    <IPC-2581 revision="C">
      <Content units="INCH"/>
      <Ecad name="TEST_INCH">
        <CadData>
          <Step name="PRIMARY">
            <Profile>
              <Polygon>
                <PolyBegin x="0" y="0"/>
                <PolyStepSegment x="2.0" y="1.5"/>
              </Polygon>
            </Profile>
            <Component refDes="R1" packageRef="0603" side="TOP">
              <Xform x="1.0" y="0.5" rotation="45.0"/>
            </Component>
          </Step>
        </CadData>
      </Ecad>
    </IPC-2581>`;

    const pkg = parseIpc2581Package(inchXml);
    expect(pkg.board.widthMm).toBeCloseTo(2.0 * 25.4);
    expect(pkg.board.heightMm).toBeCloseTo(1.5 * 25.4);

    const r1 = pkg.components.find((c) => c.refDes === "R1");
    expect(r1?.xMm).toBeCloseTo(25.4);
    expect(r1?.yMm).toBeCloseTo(12.7);
    expect(r1?.rotationDegrees).toBe(45.0);
  });

  it("rejects or neutralizes external entity references (XXE)", () => {
    const maliciousXml = `<?xml version="1.0"?>
    <!DOCTYPE foo [
      <!ELEMENT foo ANY >
      <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
    <IPC-2581 revision="B">
      <Content units="MILLIMETER"/>
      <Ecad name="&xxe;">
        <CadData>
          <Step name="PRIMARY">
            <Component refDes="U1" packageRef="SO8" side="TOP">
              <Xform x="10" y="10"/>
            </Component>
          </Step>
        </CadData>
      </Ecad>
    </IPC-2581>`;

    expect(() => parseIpc2581Package(maliciousXml)).toThrow(/security|entity|malformed|doctype/i);
  });
});
