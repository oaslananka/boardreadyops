import type { ComponentSide, NormalizedComponent } from "@boardreadyops/contracts";
import { parseDelimitedRows } from "../util/delimited.js";

interface CentroidRecord {
  refDes: string;
  xMm?: number;
  yMm?: number;
  rotationDegrees?: number;
  side: ComponentSide;
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
  const refIdx = findColumnIndex(header, ["designator", "reference", "ref", "refdes", "component", "part"]);
  const valIdx = findColumnIndex(header, ["comment", "value", "val", "description"]);
  const fpIdx = findColumnIndex(header, ["footprint", "package", "pattern"]);
  const mpnIdx = findColumnIndex(header, [
    "manufacturer part number",
    "mfr part #",
    "mfr part",
    "mpn",
    "part number",
    "part #",
    "lcsc part #",
    "jlcpcb part #",
    "lcsc part",
  ]);
  const dnpIdx = findColumnIndex(header, ["dnp", "do not populate", "no_fit"]);

  if (refIdx === -1) return [];

  // Parse centroid records if available
  const centroidMap = new Map<string, CentroidRecord>();
  if (centroidContent) {
    const centroidRows = parseRows(centroidContent);
    const firstCentroidRow = centroidRows[0];
    if (centroidRows.length >= 2 && firstCentroidRow) {
      const cHeader = firstCentroidRow.map((h) => h.trim().toLowerCase());
      const cRefIdx = findColumnIndex(cHeader, ["designator", "ref", "refdes", "component", "name", "part"]);
      const cXIdx = findColumnIndex(cHeader, ["mid x", "posx", "x(mm)", "x", "ref x"]);
      const cYIdx = findColumnIndex(cHeader, ["mid y", "posy", "y(mm)", "y", "ref y"]);
      const cRotIdx = findColumnIndex(cHeader, ["rotation", "rot", "angle"]);
      const cLayerIdx = findColumnIndex(cHeader, ["layer", "side"]);

      if (cRefIdx !== -1) {
        for (let i = 1; i < centroidRows.length; i++) {
          const row = centroidRows[i];
          if (!row) continue;
          const ref = (cRefIdx !== -1 ? row[cRefIdx] : undefined)?.trim();
          if (!ref) continue;

          const xMm = cXIdx !== -1 ? parseDimensionMm(row[cXIdx]) : undefined;
          const yMm = cYIdx !== -1 ? parseDimensionMm(row[cYIdx]) : undefined;
          const rotationDegrees = cRotIdx !== -1 ? parseRotation(row[cRotIdx]) : undefined;
          const side = cLayerIdx !== -1 ? parseSide(row[cLayerIdx]) : "top";

          centroidMap.set(ref.toUpperCase(), {
            refDes: ref,
            ...(xMm !== undefined ? { xMm } : {}),
            ...(yMm !== undefined ? { yMm } : {}),
            ...(rotationDegrees !== undefined ? { rotationDegrees } : {}),
            side,
          });
        }
      }
    }
  }

  const components: NormalizedComponent[] = [];

  for (let r = 1; r < bomRows.length; r++) {
    const row = bomRows[r];
    if (!row) continue;
    const rawRef = (refIdx !== -1 ? row[refIdx] : undefined)?.trim();
    if (!rawRef) continue;

    const value = (valIdx !== -1 ? row[valIdx]?.trim() : "") || "";
    const footprint = (fpIdx !== -1 ? row[fpIdx]?.trim() : "") || "";
    const rawMpn = mpnIdx !== -1 ? row[mpnIdx]?.trim() : undefined;
    const mpn = rawMpn && rawMpn.length > 0 ? rawMpn : undefined;

    const dnpRaw = (dnpIdx !== -1 ? row[dnpIdx]?.trim().toLowerCase() : "") || "";
    const isDnp =
      dnpRaw === "1" ||
      dnpRaw === "true" ||
      dnpRaw === "dnp" ||
      dnpRaw === "no_fit" ||
      /DNP/i.test(value) ||
      (mpn ? /DNP/i.test(mpn) : false);

    // Expand multiple designators: "C1, C2" -> ["C1", "C2"]
    const refList = splitDesignators(rawRef);

    for (const ref of refList) {
      const placement = centroidMap.get(ref.toUpperCase());
      components.push({
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
      });
    }
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
