import { describe, expect, it } from "vitest";
import { parseBomAndCentroid } from "../../../src/multicad/bom-centroid-parser.js";

describe("Multi-CAD BOM & Centroid Parser", () => {
  it("parses Altium-style CSV BOM and correlates with centroid placements", () => {
    const bomCsv = `
"Comment","Description","Designator","Footprint","Manufacturer Part Number"
"100nF","0402 16V Ceramic Cap","C1, C2","0402","CL05B104KO5NNNC"
"STM32F405","MCU LQFP-64","U1","LQFP-64","STM32F405RGT6"
"DNP Part","Test Jumper","J1","HDR-1x2","DNP"
`;

    const centroidCsv = `
"Designator","Mid X","Mid Y","Rotation","Layer"
"C1","10.5mm","15.2mm","0.0","Top"
"C2","12.0mm","15.2mm","90.0","Top"
"U1","25.0mm","30.0mm","45.0","Bottom"
`;

    const components = parseBomAndCentroid(bomCsv, centroidCsv, "BOM.csv");

    expect(components).toHaveLength(4); // C1, C2, U1, J1

    const c1 = components.find((c) => c.refDes === "C1");
    expect(c1).toBeDefined();
    expect(c1?.value).toBe("100nF");
    expect(c1?.footprint).toBe("0402");
    expect(c1?.mpn).toBe("CL05B104KO5NNNC");
    expect(c1?.side).toBe("top");
    expect(c1?.xMm).toBeCloseTo(10.5, 1);
    expect(c1?.yMm).toBeCloseTo(15.2, 1);
    expect(c1?.dnp).toBe(false);

    const u1 = components.find((c) => c.refDes === "U1");
    expect(u1?.side).toBe("bottom");
    expect(u1?.rotationDegrees).toBe(45);

    const j1 = components.find((c) => c.refDes === "J1");
    expect(j1?.dnp).toBe(true);
  });

  it("handles EasyEDA BOM with JLCPCB Part numbers", () => {
    const easyEdaBom = `
Comment,Designator,Footprint,LCSC Part #
10k,R1,0603,C25804
10k,R2,0603,C25804
`;

    const components = parseBomAndCentroid(easyEdaBom, undefined, "easyeda_bom.csv");
    expect(components).toHaveLength(2);
    expect(components[0]?.mpn).toBe("C25804");
    expect(components[0]?.value).toBe("10k");
  });
});
