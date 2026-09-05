import type { ComponentSide, NormalizedComponent } from "@boardreadyops/contracts";
import { parseDelimitedRows } from "../util/delimited.js";

interface CentroidRecord {
  refDes: string;
  xMm?: number;
  yMm?: number;
  rotationDegrees?: number;
  side: ComponentSide;
}

interface BomColumnIndices {
  refIdx: number;
  valIdx: number;
  fpIdx: number;
  mpnIdx: number;
  dnpIdx: number;
}

function resolveBomColumns(header: string[]): BomColumnIndices {
  return {
    refIdx: findColumnIndex(header, ["designator", "reference", "ref", "refdes", "component", "part"]),
    valIdx: findColumnIndex(header, ["comment", "value", "val", "description"]),
    fpIdx: findColumnIndex(header, ["footprint", "package", "pattern"]),
    mpnIdx: findColumnIndex(header, [
      "manufacturer part number",
      "mfr part #",
      "mfr part",
      "mpn",
      "part number",
      "part #",
      "lcsc part #",
      "jlcpcb part #",
      "lcsc part",
    ]),
    dnpIdx: findColumnIndex(header, ["dnp", "do not populate", "no_fit"]),
  };
}

interface CentroidColumnIndices {
  refIdx: number;
  xIdx: number;
  yIdx: number;
  rotIdx: number;
  layerIdx: number;
}

function resolveCentroidColumns(header: string[]): CentroidColumnIndices {
  return {
    refIdx: findColumnIndex(header, ["designator", "ref", "refdes", "component", "name", "part"]),
    xIdx: findColumnIndex(header, ["mid x", "posx", "x(mm)", "x", "ref x"]),
    yIdx: findColumnIndex(header, ["mid y", "posy", "y(mm)", "y", "ref y"]),
    rotIdx: findColumnIndex(header, ["rotation", "rot", "angle"]),
    layerIdx: findColumnIndex(header, ["layer", "side"]),
  };
}

function buildCentroidRecord(row: string[], columns: CentroidColumnIndices): CentroidRecord | null {
  const ref = row[columns.refIdx]?.trim();
  if (!ref) return null;

  const xMm = columns.xIdx !== -1 ? parseDimensionMm(row[columns.xIdx]) : undefined;
  const yMm = columns.yIdx !== -1 ? parseDimensionMm(row[columns.yIdx]) : undefined;
  const rotationDegrees = columns.rotIdx !== -1 ? parseRotation(row[columns.rotIdx]) : undefined;
  const side = columns.layerIdx !== -1 ? parseSide(row[columns.layerIdx]) : "top";

  return {
    refDes: ref,
    ...(xMm !== undefined ? { xMm } : {}),
    ...(yMm !== undefined ? { yMm } : {}),
    ...(rotationDegrees !== undefined ? { rotationDegrees } : {}),
    side,
  };
}

function parseCentroidMap(centroidContent: string | undefined): Map<string, CentroidRecord> {
  const centroidMap = new Map<string, CentroidRecord>();
  if (!centroidContent) return centroidMap;

  const centroidRows = parseRows(centroidContent);
  const firstCentroidRow = centroidRows[0];
  if (centroidRows.length < 2 || !firstCentroidRow) return centroidMap;

  const columns = resolveCentroidColumns(firstCentroidRow.map((h) => h.trim().toLowerCase()));
  if (columns.refIdx === -1) return centroidMap;

  for (let i = 1; i < centroidRows.length; i++) {
    const row = centroidRows[i];
    if (!row) continue;
    const record = buildCentroidRecord(row, columns);
    if (record) centroidMap.set(record.refDes.toUpperCase(), record);
  }

  return centroidMap;
}

function isDnpRow(dnpRaw: string, value: string, mpn: string | undefined): boolean {
  return (
    dnpRaw === "1" ||
    dnpRaw === "true" ||
    dnpRaw === "dnp" ||
    dnpRaw === "no_fit" ||
    /DNP/i.test(value) ||
    (mpn ? /DNP/i.test(mpn) : false)
  );
}

function componentsFromBomRow(
  row: string[],
  columns: BomColumnIndices,
  centroidMap: Map<string, CentroidRecord>,
  sourceFileName: string,
): NormalizedComponent[] {
  const rawRef = (columns.refIdx !== -1 ? row[columns.refIdx] : undefined)?.trim();
  if (!rawRef) return [];

  const value = (columns.valIdx !== -1 ? row[columns.valIdx]?.trim() : "") || "";
  const footprint = (columns.fpIdx !== -1 ? row[columns.fpIdx]?.trim() : "") || "";
  const rawMpn = columns.mpnIdx !== -1 ? row[columns.mpnIdx]?.trim() : undefined;
  const mpn = rawMpn && rawMpn.length > 0 ? rawMpn : undefined;
  const dnpRaw = (columns.dnpIdx !== -1 ? row[columns.dnpIdx]?.trim().toLowerCase() : "") || "";
  const isDnp = isDnpRow(dnpRaw, value, mpn);

  // Expand multiple designators: "C1, C2" -> ["C1", "C2"]
  return splitDesignators(rawRef).map((ref) => {
    const placement = centroidMap.get(ref.toUpperCase());
    return {
      refDes: ref,
      value,
      footprint,
      ...(mpn ? { mpn } : {}),
      side: placement?.side || "top",
      ...(placement?.xMm !== undefined ? { xMm: placement.xMm } : {}),
      ...(placement?.yMm !== undefined ? { yMm: placement.yMm } : {}),
      ...(placement?.rotationDegrees !== undefined ? { rotationDegrees: placement.rotationDegrees } : {}),
      dnp: isDnp,
      sourceFile: sourceFileName,
    };
  });
}

export function parseBomAndCentroid(
  bomContent: string,
  centroidContent?: string,
  sourceFileName = "BOM.csv",
): NormalizedComponent[] {
  const bomRows = parseRows(bomContent);
  if (bomRows.length < 2) return [];

  const firstBomRow = bomRows[0];
  if (!firstBomRow) return [];

  const header = firstBomRow.map((h) => h.trim().toLowerCase());
  const columns = resolveBomColumns(header);
  if (columns.refIdx === -1) return [];

  const centroidMap = parseCentroidMap(centroidContent);
  const components: NormalizedComponent[] = [];

  for (let r = 1; r < bomRows.length; r++) {
    const row = bomRows[r];
    if (!row) continue;
    components.push(...componentsFromBomRow(row, columns, centroidMap, sourceFileName));
  }

  return components;
}

function parseRows(content: string): string[][] {
  const delimiter = content.includes("\t") && !content.includes(",") ? "\t" : ",";
  return parseDelimitedRows(content, delimiter).filter((row) => row.some((c) => c.trim().length > 0));
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  for (const candidate of candidates) {
    if (candidate === "part") continue;
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function splitDesignators(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function parseDimensionMm(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().toLowerCase();
  const num = Number.parseFloat(clean);
  if (Number.isNaN(num)) return undefined;

  if (clean.endsWith("mil")) {
    return num * 0.0254;
  }
  if (clean.endsWith("in") || clean.endsWith("inch")) {
    return num * 25.4;
  }
  return num;
}

function parseRotation(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const num = Number.parseFloat(raw.trim());
  return Number.isNaN(num) ? undefined : num;
}

function parseSide(raw: string | undefined): ComponentSide {
  if (!raw) return "top";
  const clean = raw.trim().toLowerCase();
  if (clean.startsWith("b") || clean.includes("bottom")) {
    return "bottom";
  }
  return "top";
}
