import {
  hasMinimumReviewCapabilities,
  normalizedComponentSchema,
  normalizedPcbPackageSchema,
} from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";

describe("Multi-CAD Contracts", () => {
  it("validates a compliant multi-CAD normalized package", () => {
    const validPackage = {
      format: "altium",
      formatVersion: "24.1",
      sourceType: "upload_bundle",
      capabilities: {
        hasGerberOutlines: true,
        hasPlatedHoles: true,
        hasNonPlatedHoles: true,
        hasBomMapping: true,
        hasCentroidPlacement: true,
        hasNetlistConnectivity: false,
        hasSchematicHierarchies: false,
      },
      board: {
        name: "Motor_Controller",
        widthMm: 85.5,
        heightMm: 54.0,
        layerCount: 4,
      },
      layers: [
        { name: "Top_Copper", role: "copper", side: "top", index: 1, filename: "Motor_Controller.GTL" },
        { name: "Bottom_Copper", role: "copper", side: "bottom", index: 4, filename: "Motor_Controller.GBL" },
      ],
      components: [
        {
          refDes: "U1",
          value: "STM32F405RGT6",
          footprint: "LQFP-64",
          mpn: "STM32F405RGT6",
          side: "top",
          xMm: 42.75,
          yMm: 27.0,
          rotationDegrees: 90,
          dnp: false,
          sourceFile: "BOM.csv",
        },
      ],
      drillHoles: [{ xMm: 5.0, yMm: 5.0, diameterMm: 3.2, plated: false }],
      parserWarnings: [],
    };

    const parsed = normalizedPcbPackageSchema.parse(validPackage);
    expect(parsed.format).toBe("altium");
    expect(parsed.components).toHaveLength(1);
    expect(parsed.capabilities.hasNetlistConnectivity).toBe(false);
  });

  it("determines minimum review capabilities accurately", () => {
    expect(
      hasMinimumReviewCapabilities({
        hasGerberOutlines: true,
        hasPlatedHoles: true,
        hasNonPlatedHoles: true,
        hasBomMapping: false,
        hasCentroidPlacement: false,
        hasNetlistConnectivity: false,
        hasSchematicHierarchies: false,
      }),
    ).toBe(true);

    expect(
      hasMinimumReviewCapabilities({
        hasGerberOutlines: false,
        hasPlatedHoles: false,
        hasNonPlatedHoles: false,
        hasBomMapping: true,
        hasCentroidPlacement: false,
        hasNetlistConnectivity: false,
        hasSchematicHierarchies: false,
      }),
    ).toBe(false);
  });

  it("rejects invalid component side or coordinates", () => {
    expect(() =>
      normalizedComponentSchema.parse({
        refDes: "R1",
        value: "10k",
        footprint: "0603",
        side: "inner1", // invalid
        dnp: false,
        sourceFile: "BOM.csv",
      }),
    ).toThrow();
  });
});
