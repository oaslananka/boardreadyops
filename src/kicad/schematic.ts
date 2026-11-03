import type { BomRow } from "../bom/types.js";
import { readDesignFile } from "./parsers/project-files.js";
import {
  directChildLists,
  findKiCadLists,
  listChildValue,
  listValue,
  parseKicadDocument,
  propertyValue,
} from "./project-model.js";

export { extractBlocks } from "./sexpr.js";

export interface SchematicSheetReference {
  sheetName?: string | undefined;
  fileName: string;
  pins: string[];
}

export interface ParsedSchematic {
  components: BomRow[];
  netLabels: Set<string>;
  localLabels: Set<string>;
  globalLabels: Set<string>;
  hierarchicalLabels: Set<string>;
  sheetReferences: SchematicSheetReference[];
  connectedPins: { designator: string; pin: string; net: string }[];
  variantProperties: Map<string, string>;
  hopOverWireCrossings: number;
}

export async function parseSchematic(file: string): Promise<ParsedSchematic> {
  const text = (await readDesignFile(file)) ?? "";
  const model = parseKicadDocument(text, "schematic");
  const components = parsedComponents(model, file);
  const localLabels = labelSet(model, "label");
  const globalLabels = labelSet(model, "global_label");
  const hierarchicalLabels = labelSet(model, "hierarchical_label");
  const connectedPins = findKiCadLists(model, "pin")
    .map((pin) => ({
      pin: listValue(pin) ?? "",
      net: listChildValue(pin, "net") ?? "",
      designator: listChildValue(pin, "ref") ?? "",
    }))
    .filter((pin) => pin.pin && pin.net && pin.designator);

  return {
    components,
    netLabels: new Set([...localLabels, ...globalLabels, ...hierarchicalLabels]),
    localLabels,
    globalLabels,
    hierarchicalLabels,
    sheetReferences: sheetReferences(model),
    connectedPins,
    variantProperties: new Map(
      components
        .map((component) => [component.reference, component.raw?.Variant])
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    hopOverWireCrossings: findKiCadLists(model, "hop_over").length,
  };
}

function parsedComponents(model: ReturnType<typeof parseKicadDocument>, file: string): BomRow[] {
  const components: BomRow[] = [];
  for (const symbol of findKiCadLists(model, "symbol")) {
    const reference = propertyValue(symbol, "Reference");
    if (!reference || !/\d/.test(reference)) {
      continue;
    }
    const variant = propertyValue(symbol, "Variant");
    components.push({
      reference,
      value: propertyValue(symbol, "Value"),
      footprint: propertyValue(symbol, "Footprint"),
      manufacturer: propertyValue(symbol, "Manufacturer") ?? propertyValue(symbol, "Mfr"),
      mpn: propertyValue(symbol, "MPN") ?? propertyValue(symbol, "Manufacturer Part Number"),
      dnp: boolValue(propertyValue(symbol, "DNP") ?? propertyValue(symbol, "Dopopulate")),
      ...(listChildValue(symbol, "in_bom") === "no" ? { inBom: false } : {}),
      raw: variant ? { Variant: variant } : undefined,
      sourcePath: file,
      sourceKind: "schematic",
    });
  }
  return components;
}

function labelSet(model: ReturnType<typeof parseKicadDocument>, head: string): Set<string> {
  return new Set(
    findKiCadLists(model, head)
      .map((label) => listValue(label) ?? "")
      .filter(Boolean),
  );
}

function sheetReferences(model: ReturnType<typeof parseKicadDocument>): SchematicSheetReference[] {
  return findKiCadLists(model, "sheet").flatMap((sheet) => {
    const fileName = propertyValue(sheet, "Sheet file");
    if (!fileName) {
      return [];
    }
    const reference: SchematicSheetReference = {
      fileName,
      pins: directChildLists(sheet, "pin")
        .map((pin) => listValue(pin) ?? "")
        .filter(Boolean),
    };
    const sheetName = propertyValue(sheet, "Sheet name");
    if (sheetName) {
      reference.sheetName = sheetName;
    }
    return [reference];
  });
}

function boolValue(value: string | undefined): boolean {
  return /^(true|yes|1|dnp)$/i.test(value ?? "");
}
