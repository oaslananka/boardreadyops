import fs from "node:fs/promises";
import path from "node:path";
import { parseSchematic, type SchematicSheetReference } from "./schematic.js";

interface SchematicGraphSheet {
  file: string;
  parentFile?: string | undefined;
  sheetName?: string | undefined;
  sheetPins: string[];
  localLabels: Set<string>;
  globalLabels: Set<string>;
  hierarchicalLabels: Set<string>;
}

interface MissingSchematicSheet {
  parentFile: string;
  sheetName?: string | undefined;
  fileName: string;
  resolvedPath: string;
}

interface UnresolvedSheetPin {
  parentFile: string;
  childFile: string;
  sheetName?: string | undefined;
  pin: string;
}

export interface SchematicNetGraph {
  rootFiles: string[];
  sheets: SchematicGraphSheet[];
  visibleNetLabels: Set<string>;
  allNetLabels: Set<string>;
  missingSheets: MissingSchematicSheet[];
  unresolvedSheetPins: UnresolvedSheetPin[];
}

interface PendingSheet {
  file: string;
  parentFile?: string | undefined;
  sheetName?: string | undefined;
  sheetPins: string[];
}

export async function discoverSchematicFileTree(rootFiles: string[]): Promise<string[]> {
  const graph = await buildSchematicNetGraph(rootFiles);
  return graph.sheets.map((sheet) => sheet.file);
}

export async function buildSchematicNetGraph(rootFiles: string[]): Promise<SchematicNetGraph> {
  const normalizedRoots = [...new Set(rootFiles.map((file) => path.resolve(file)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const queue: PendingSheet[] = normalizedRoots.map((file) => ({ file, sheetPins: [] }));
  const visited = new Set<string>();
  const sheets: SchematicGraphSheet[] = [];
  const missingSheets: MissingSchematicSheet[] = [];
  const unresolvedSheetPins: UnresolvedSheetPin[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    const file = path.resolve(next.file);
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    await processSheetQueueItem(file, next, sheets, missingSheets, unresolvedSheetPins, queue);
  }

  const rootSet = new Set(normalizedRoots);
  const visibleNetLabels = new Set<string>();
  const allNetLabels = new Set<string>();
  for (const sheet of sheets) {
    addAll(allNetLabels, sheet.localLabels);
    addAll(allNetLabels, sheet.globalLabels);
    addAll(allNetLabels, sheet.hierarchicalLabels);
    addAll(visibleNetLabels, sheet.globalLabels);
    if (rootSet.has(sheet.file)) {
      addAll(visibleNetLabels, sheet.localLabels);
      addAll(visibleNetLabels, sheet.hierarchicalLabels);
    }
    for (const pin of sheet.sheetPins) {
      if (sheet.hierarchicalLabels.has(pin)) {
        visibleNetLabels.add(pin);
      }
    }
  }

  return { rootFiles: normalizedRoots, sheets, visibleNetLabels, allNetLabels, missingSheets, unresolvedSheetPins };
}

async function processSheetQueueItem(
  file: string,
  next: PendingSheet,
  sheets: SchematicGraphSheet[],
  missingSheets: MissingSchematicSheet[],
  unresolvedSheetPins: UnresolvedSheetPin[],
  queue: PendingSheet[],
): Promise<void> {
  const parsed = await parseSchematic(file);
  const sheet: SchematicGraphSheet = {
    file,
    parentFile: next.parentFile,
    sheetName: next.sheetName,
    sheetPins: [...new Set(next.sheetPins)],
    localLabels: parsed.localLabels,
    globalLabels: parsed.globalLabels,
    hierarchicalLabels: parsed.hierarchicalLabels,
  };
  sheets.push(sheet);

  for (const pin of sheet.sheetPins) {
    if (!sheet.hierarchicalLabels.has(pin)) {
      unresolvedSheetPins.push({
        parentFile: next.parentFile ?? file,
        childFile: file,
        sheetName: next.sheetName,
        pin,
      });
    }
  }

  for (const reference of parsed.sheetReferences) {
    const resolvedPath = path.resolve(path.dirname(file), reference.fileName);
    if (!(await fileExists(resolvedPath))) {
      missingSheets.push(missingSheet(file, reference, resolvedPath));
      continue;
    }
    queue.push({
      file: resolvedPath,
      parentFile: file,
      sheetName: reference.sheetName,
      sheetPins: reference.pins,
    });
  }
}

function missingSheet(
  parentFile: string,
  reference: SchematicSheetReference,
  resolvedPath: string,
): MissingSchematicSheet {
  const result: MissingSchematicSheet = { parentFile, fileName: reference.fileName, resolvedPath };
  if (reference.sheetName) {
    result.sheetName = reference.sheetName;
  }
  return result;
}

function addAll(target: Set<string>, source: Set<string>): void {
  for (const value of source) {
    target.add(value);
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}
