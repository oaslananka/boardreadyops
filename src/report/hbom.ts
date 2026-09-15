import type { FabricationSnapshot } from "../core/diff/fabrication.js";
import type { FirmwareDependencyRecord } from "../core/firmware.js";
import type { RunResult } from "../core/result.js";
import { assessComponentIdentity, summariseIndexedIdentifiers } from "./component-identity.js";

interface CycloneDxOrganizationalEntity {
  name: string;
}

interface CycloneDxProperty {
  name: string;
  value: string;
}

interface CycloneDxExternalReference {
  type: "distribution" | "documentation" | "website";
  url: string;
}

interface CycloneDxIdentityMethod {
  technique: "manifest-analysis";
  confidence: number;
  value?: string | undefined;
}

/**
 * CycloneDX identity evidence, which is the spec's own place to say how sure we are of an
 * identifier and how we arrived at it. Using it rather than inventing a property, because a
 * consumer that understands CycloneDX already knows how to read this.
 */
interface CycloneDxIdentityEvidence {
  field: "purl";
  confidence: number;
  concludedValue: string;
  methods: CycloneDxIdentityMethod[];
}

/**
 * CycloneDX component types this document emits.
 *
 * `device` for a hardware part, `library` for a firmware dependency, `framework` for the firmware
 * framework itself -- all three are spec enum values. The framework is a different kind of thing
 * from a component and is tracked by CPE rather than PURL, so saying so keeps a consumer from
 * treating it as a library that simply had no advisories.
 */
type CycloneDxComponentType = "device" | "library" | "framework";

interface CycloneDxHbomComponent {
  type: CycloneDxComponentType;
  name: string;
  version?: string | undefined;
  "bom-ref": string;
  manufacturer?: CycloneDxOrganizationalEntity | undefined;
  supplier?: CycloneDxOrganizationalEntity | undefined;
  purl?: string | undefined;
  externalReferences?: CycloneDxExternalReference[] | undefined;
  evidence?: { identity: CycloneDxIdentityEvidence[] } | undefined;
  properties: CycloneDxProperty[];
}

export interface CycloneDxHbom {
  $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json";
  bomFormat: "CycloneDX";
  specVersion: "1.7";
  version: 1;
  metadata: {
    timestamp: string;
    tools: {
      components: [
        {
          type: "application";
          name: "boardreadyops";
          version: string;
        },
      ];
    };
    component: {
      type: "device";
      name: string;
      "bom-ref": string;
    };
    properties: CycloneDxProperty[];
  };
  components: CycloneDxHbomComponent[];
  dependencies: Array<{
    ref: string;
    dependsOn: string[];
  }>;
}

type BomRow = FabricationSnapshot["bom"][number];

export function formatHbom(result: RunResult): string {
  return `${JSON.stringify(createHbom(result), null, 2)}\n`;
}

export function createHbom(result: RunResult): CycloneDxHbom {
  const rootRef = "boardreadyops:hardware";
  const components = [
    ...result.fabrication.bom.map((row) => componentFromBomRow(row)),
    ...(result.firmware?.dependencies ?? []).map((dependency) => componentFromFirmwareDependency(dependency)),
  ];
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      timestamp: result.generatedAt,
      tools: {
        components: [
          {
            type: "application",
            name: result.tool.name,
            version: result.tool.version,
          },
        ],
      },
      component: {
        type: "device",
        name: hardwareName(result),
        "bom-ref": rootRef,
      },
      properties: metadataProperties(components),
    },
    components,
    dependencies: [
      {
        ref: rootRef,
        dependsOn: components.map((component) => component["bom-ref"]),
      },
    ],
  };
}

function componentFromBomRow(row: BomRow): CycloneDxHbomComponent {
  const component: CycloneDxHbomComponent = {
    type: "device",
    name: row.mpn ?? row.value ?? row.reference,
    "bom-ref": componentRef(row),
    properties: componentProperties(row),
  };
  if (row.value) {
    component.version = row.value;
  }
  if (row.manufacturer) {
    component.manufacturer = { name: row.manufacturer };
  }
  if (row.suppliers?.[0]) {
    component.supplier = { name: row.suppliers[0] };
  }
  const externalReferences = externalReferencesFromSuppliers(row.suppliers ?? []);
  if (externalReferences.length > 0) {
    component.externalReferences = externalReferences;
  }
  const purl = purlFromRow(row);
  if (purl) {
    component.purl = purl;
    const assessment = assessComponentIdentity(purl);
    component.evidence = {
      identity: [
        {
          field: "purl",
          confidence: assessment.confidence,
          concludedValue: purl,
          methods: [{ technique: assessment.technique, confidence: assessment.confidence, value: purl }],
        },
      ],
    };
    // The claim a reader most needs and the spec has no field for: whether a "no advisories found"
    // answer about this identifier would mean anything.
    component.properties.push({
      name: "boardreadyops:vulnerabilityIndexed",
      value: String(assessment.vulnerabilityIndexed),
    });
  }
  return component;
}

/**
 * Document-level counts, so the gap is visible at the top rather than only per component.
 *
 * A reader who sees `0 of 42` knows the scanner result below is about coverage, not cleanliness.
 */
function metadataProperties(components: readonly CycloneDxHbomComponent[]): CycloneDxProperty[] {
  const summary = summariseIndexedIdentifiers(components.map((component) => component.purl));
  const firmware = components.filter((component) => componentClassOf(component) === "firmware");
  const firmwareSummary = summariseIndexedIdentifiers(firmware.map((component) => component.purl));
  return [
    // Both classes now, so the document says which it contains rather than asserting "hardware".
    { name: "boardreadyops:componentClass", value: firmware.length > 0 ? "hardware+firmware" : "hardware" },
    { name: "boardreadyops:componentCount", value: String(summary.total) },
    { name: "boardreadyops:vulnerabilityIndexedComponentCount", value: String(summary.indexed) },
    // Split out, because the two classes fail to be identifiable for different reasons and a
    // reader deciding what to chase needs to know which.
    { name: "boardreadyops:hardwareComponentCount", value: String(summary.total - firmware.length) },
    { name: "boardreadyops:firmwareComponentCount", value: String(firmware.length) },
    { name: "boardreadyops:vulnerabilityIndexedFirmwareCount", value: String(firmwareSummary.indexed) },
  ];
}

function componentClassOf(component: CycloneDxHbomComponent): string | undefined {
  return component.properties.find((entry) => entry.name === "boardreadyops:componentClass")?.value;
}

/**
 * A firmware dependency as an SBOM component.
 *
 * Emitted with `vulnerabilityIndexed` exactly as hardware components are, and for the same reason:
 * an unidentified dependency listed with no advisories found is a false clean bill. The difference
 * is that here the identifier, when there is one, came from a curated mapping rather than from the
 * manifest -- so the evidence records that, and `pinned: false` keeps the PURL off a version the
 * manifest only expressed as a range. See #785.
 */
function componentFromFirmwareDependency(dependency: FirmwareDependencyRecord): CycloneDxHbomComponent {
  const component: CycloneDxHbomComponent = {
    type: dependency.origin === "framework" ? "framework" : "library",
    name: dependency.name,
    "bom-ref": firmwareComponentRef(dependency),
    properties: [
      { name: "boardreadyops:componentClass", value: "firmware" },
      { name: "boardreadyops:manifestPath", value: dependency.manifestPath },
      { name: "boardreadyops:dependencyOrigin", value: dependency.origin },
      { name: "boardreadyops:versionPinned", value: String(dependency.pinned) },
      { name: "boardreadyops:vulnerabilityIndexed", value: String(dependency.searchable) },
      ...(dependency.identitySource
        ? [{ name: "boardreadyops:identitySource", value: dependency.identitySource }]
        : []),
    ],
  };
  if (dependency.versionSpec) {
    component.version = dependency.versionSpec;
  }
  if (dependency.purl) {
    component.purl = dependency.purl;
    component.evidence = {
      identity: [
        {
          field: "purl",
          confidence: 0.5,
          concludedValue: dependency.purl,
          methods: [{ technique: "manifest-analysis", confidence: 0.5, value: dependency.purl }],
        },
      ],
    };
  }
  return component;
}

function firmwareComponentRef(dependency: FirmwareDependencyRecord): string {
  return ["boardreadyops:firmware", sanitizeRef(dependency.manifestPath), sanitizeRef(dependency.name)].join(":");
}

function componentProperties(row: BomRow): CycloneDxProperty[] {
  return [
    // Declared per component so a consumer can filter hardware from firmware without inferring it
    // from the component type.
    { name: "boardreadyops:componentClass", value: "hardware" },
    { name: "kicad:reference", value: row.reference },
    property("kicad:footprint", row.footprint),
    property("kicad:dnp", String(Boolean(row.dnp))),
    property("boardreadyops:mpn", row.mpn),
    property("boardreadyops:sourcePath", row.sourcePath),
    property("boardreadyops:lifecycle", row.lifecycle),
    property("boardreadyops:compliance", row.compliance),
    property("boardreadyops:quantity", row.quantity === undefined ? undefined : String(row.quantity)),
    ...(row.suppliers ?? []).map((supplier) => property("boardreadyops:supplier", supplier)),
  ].filter((entry): entry is CycloneDxProperty => Boolean(entry));
}

function property(name: string, value: string | undefined): CycloneDxProperty | undefined {
  return value ? { name, value } : undefined;
}

function hardwareName(result: RunResult): string {
  if (result.projects.length === 1) {
    return stripProjectExtension(result.projects[0]?.projectFile ?? "hardware");
  }
  return "boardreadyops-hardware-workspace";
}

function stripProjectExtension(projectFile: string): string {
  return projectFile.replace(/\.kicad_pro$/i, "");
}

function componentRef(row: BomRow): string {
  return ["boardreadyops:component", sanitizeRef(row.sourcePath ?? "bom"), sanitizeRef(row.reference)].join(":");
}

function sanitizeRef(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replaceAll("/", ".");
}

function externalReferencesFromSuppliers(suppliers: string[]): CycloneDxExternalReference[] {
  return suppliers
    .filter((supplier) => /^https?:\/\//i.test(supplier))
    .map((url) => ({
      type: "distribution",
      url,
    }));
}

function purlFromRow(row: BomRow): string | undefined {
  if (!row.mpn || !row.manufacturer) {
    return undefined;
  }
  const namespace = encodeURIComponent(row.manufacturer);
  const name = encodeURIComponent(row.mpn);
  return `pkg:generic/${namespace}/${name}`;
}
