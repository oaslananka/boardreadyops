import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import hbomSchema from "../../../schemas/hbom.schema.json" with { type: "json" };
import type { FabricationSnapshot } from "../../../src/core/diff/fabrication.js";
import type { RunResult } from "../../../src/core/result.js";
import { createHbom, formatHbom } from "../../../src/report/hbom.js";

describe("CycloneDX HBOM formatter", () => {
  it("emits deterministic hardware components from fabrication BOM rows", () => {
    const hbom = createHbom(resultWithBomRows());

    expect(hbom).toMatchObject({
      $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      metadata: {
        timestamp: "2026-05-24T21:00:00.000Z",
        component: {
          type: "device",
          name: "safe-basic",
        },
        properties: [
          { name: "boardreadyops:componentClass", value: "hardware" },
          { name: "boardreadyops:componentCount", value: "2" },
          { name: "boardreadyops:vulnerabilityIndexedComponentCount", value: "0" },
        ],
      },
    });
    expect(hbom.components).toHaveLength(2);
    expect(hbom.components[0]).toMatchObject({
      type: "device",
      name: "RC0603FR-0710KL",
      version: "10k",
      manufacturer: { name: "Yageo" },
      supplier: { name: "Digi-Key" },
      properties: expect.arrayContaining([
        { name: "kicad:reference", value: "R1" },
        { name: "kicad:footprint", value: "Resistor_SMD:R_0603" },
        { name: "kicad:dnp", value: "false" },
        { name: "boardreadyops:mpn", value: "RC0603FR-0710KL" },
        { name: "boardreadyops:sourcePath", value: "bom.csv" },
        { name: "boardreadyops:compliance", value: "RoHS Compliant" },
      ]),
    });
    expect(hbom.components[1]).toMatchObject({
      type: "device",
      name: "CAP-100N",
      properties: expect.arrayContaining([
        { name: "kicad:reference", value: "C1" },
        { name: "kicad:dnp", value: "true" },
        { name: "boardreadyops:lifecycle", value: "NRND" },
      ]),
    });
    expect(hbom.components.map((component) => component["bom-ref"])).toEqual([
      "boardreadyops:component:bom.csv:R1",
      "boardreadyops:component:bom.csv:C1",
    ]);
  });

  it("says of every component whether its identifier can be looked up", () => {
    const hbom = createHbom(resultWithBomRows());

    for (const component of hbom.components) {
      // The identifier we emit is pkg:generic, which OSV accepts and never matches. Saying so per
      // component is what stops a scanner's empty answer reading as a clean bill. See #785.
      expect(component.purl, component.name).toMatch(/^pkg:generic\//u);
      expect(component.properties, component.name).toEqual(
        expect.arrayContaining([{ name: "boardreadyops:vulnerabilityIndexed", value: "false" }]),
      );
      expect(component.evidence, component.name).toEqual({
        identity: [
          {
            field: "purl",
            confidence: 0.5,
            concludedValue: component.purl,
            methods: [{ technique: "manifest-analysis", confidence: 0.5, value: component.purl }],
          },
        ],
      });
    }
  });

  it("counts the identifiable components at the top of the document", () => {
    // A reader has to see the gap without walking every component.
    const hbom = createHbom(resultWithBomRows());

    expect(hbom.metadata.properties).toEqual(
      expect.arrayContaining([
        { name: "boardreadyops:componentCount", value: "2" },
        { name: "boardreadyops:vulnerabilityIndexedComponentCount", value: "0" },
      ]),
    );
  });

  it("claims nothing about identity for a component with no identifier", () => {
    const result = resultWithBomRows();
    const [row] = result.fabrication.bom;
    if (!row) throw new Error("Expected fixture BOM row.");
    result.fabrication.bom = [{ ...row, manufacturer: undefined, mpn: undefined }];

    const [component] = createHbom(result).components;
    // No PURL means no identity evidence and no indexed property -- an absent claim rather than a
    // false one. The component still counts in the total.
    expect(component).not.toHaveProperty("purl");
    expect(component).not.toHaveProperty("evidence");
    expect(component?.properties.map((entry) => entry.name)).not.toContain("boardreadyops:vulnerabilityIndexed");
    expect(createHbom(result).metadata.properties).toEqual(
      expect.arrayContaining([
        { name: "boardreadyops:componentCount", value: "1" },
        { name: "boardreadyops:vulnerabilityIndexedComponentCount", value: "0" },
      ]),
    );
  });

  it("formats HBOM JSON that validates against the bundled schema", () => {
    const parsed = JSON.parse(formatHbom(resultWithBomRows()));
    const validate = new Ajv2020({ allErrors: true }).compile(hbomSchema);

    expect(validate(parsed), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("emits optional supplier references and fallback hardware names", () => {
    const result = resultWithBomRows();
    result.projects.push({
      projectFile: "aux.kicad_pro",
      root: "aux",
      schematicFiles: ["aux.kicad_sch"],
      boardFiles: ["aux.kicad_pcb"],
      jobsetFiles: [],
    });
    result.fabrication.bom = [
      {
        reference: "J 1",
        sourcePath: "nested/bom custom.csv",
        suppliers: ["https://supplier.example/parts/J1"],
        dnp: false,
      },
      {
        reference: "TP1",
        quantity: 2,
        dnp: true,
      },
    ];

    const hbom = createHbom(result);

    expect(hbom.metadata.component.name).toBe("boardreadyops-hardware-workspace");
    expect(hbom.components).toEqual([
      expect.objectContaining({
        type: "device",
        name: "J 1",
        "bom-ref": "boardreadyops:component:nested.bom-custom.csv:J-1",
        externalReferences: [{ type: "distribution", url: "https://supplier.example/parts/J1" }],
        properties: expect.arrayContaining([
          { name: "kicad:reference", value: "J 1" },
          { name: "kicad:dnp", value: "false" },
          { name: "boardreadyops:supplier", value: "https://supplier.example/parts/J1" },
        ]),
      }),
      expect.objectContaining({
        type: "device",
        name: "TP1",
        "bom-ref": "boardreadyops:component:bom:TP1",
        properties: expect.arrayContaining([
          { name: "kicad:reference", value: "TP1" },
          { name: "kicad:dnp", value: "true" },
          { name: "boardreadyops:quantity", value: "2" },
        ]),
      }),
    ]);
    expect(hbom.components[0]).not.toHaveProperty("purl");
    expect(hbom.components[1]).not.toHaveProperty("supplier");
    expect(hbom.components[1]).not.toHaveProperty("externalReferences");
  });

  it("uses a stable hardware name when a single project record is incomplete", () => {
    const result = resultWithBomRows();
    const [project] = result.projects;
    if (!project) {
      throw new Error("Expected fixture project.");
    }
    result.projects = [
      {
        ...project,
        projectFile: undefined as unknown as string,
      },
    ];

    expect(createHbom(result).metadata.component.name).toBe("hardware");
  });
});

function resultWithBomRows(): RunResult {
  const fabrication: FabricationSnapshot = {
    bom: [
      {
        reference: "R1",
        sourcePath: "bom.csv",
        value: "10k",
        footprint: "Resistor_SMD:R_0603",
        manufacturer: "Yageo",
        mpn: "RC0603FR-0710KL",
        suppliers: ["Digi-Key"],
        lifecycle: "Active",
        compliance: "RoHS Compliant",
        dnp: false,
      },
      {
        reference: "C1",
        sourcePath: "bom.csv",
        value: "100nF",
        footprint: "Capacitor_SMD:C_0603",
        manufacturer: "Murata",
        mpn: "CAP-100N",
        suppliers: ["Mouser", "Digi-Key"],
        lifecycle: "NRND",
        dnp: true,
      },
    ],
    outputs: [],
  };
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.2" },
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, maxSeverity: "none", failed: false },
    projects: [
      {
        projectFile: "safe-basic.kicad_pro",
        root: ".",
        schematicFiles: ["safe-basic.kicad_sch"],
        boardFiles: ["safe-basic.kicad_pcb"],
        jobsetFiles: [],
      },
    ],
    findings: [],
    fabrication,
    generatedAt: "2026-05-24T21:00:00.000Z",
  };
}
