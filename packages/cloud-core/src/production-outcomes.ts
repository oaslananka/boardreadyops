import { createHash } from "node:crypto";

export type ProductionDefectCategory = "aoi" | "spi" | "functional_test" | "ncr" | "rma";

export type ProductionBatchDefect = {
  category: ProductionDefectCategory;
  code: string;
  count: number;
  notes?: string | undefined;
};

export type ProductionBatchInput = {
  externalBatchId: string;
  manufacturer: string;
  manufacturedOn: string;
  quantity: number;
  firstPassYieldBps?: number | undefined;
  reworkCount: number;
  scrapCount: number;
  notes?: string | undefined;
  correctiveAction?: string | undefined;
  defects: readonly ProductionBatchDefect[];
};

export type ParsedProductionOutcomeCsv = {
  sourceSha256: string;
  batches: readonly ProductionBatchInput[];
};

const maximumCsvBytes = 2 * 1024 * 1024;
const maximumRows = 10_000;
const maximumColumns = 64;
const maximumCellLength = 4_000;

const requiredHeaders = ["batch_id", "manufacturer", "manufactured_on", "quantity"] as const;
const defectCategories = new Set<ProductionDefectCategory>(["aoi", "spi", "functional_test", "ncr", "rma"]);

function parseCsvRows(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > maximumCsvBytes) {
    throw new Error("Production outcome CSV exceeds the 2 MiB import limit");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    if (cell.length > maximumCellLength) throw new Error("Production outcome CSV cell exceeds 4000 characters");
    row.push(cell);
    cell = "";
    if (row.length > maximumColumns) throw new Error("Production outcome CSV exceeds 64 columns");
  };

  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > maximumRows + 1) throw new Error("Production outcome CSV exceeds 10000 data rows");
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      pushCell();
    } else if (char === "\n") {
      cell = cell.replace(/\r$/u, "");
      pushRow();
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error("Production outcome CSV contains an unterminated quoted field");

  if (cell.length > 0 || row.length > 0 || (text.length > 0 && !text.endsWith("\n"))) {
    cell = cell.replace(/\r$/u, "");
    pushRow();
  }

  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function boundedText(value: string | undefined, field: string, maximum: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
  return normalized;
}

function requiredText(value: string | undefined, field: string, maximum: number): string {
  const normalized = boundedText(value, field, maximum);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function nonNegativeInteger(value: string | undefined, field: string, fallback = 0): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (!/^\d+$/u.test(normalized)) throw new Error(`${field} must be a non-negative integer`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} is outside the supported integer range`);
  return parsed;
}

function positiveInteger(value: string | undefined, field: string): number {
  const parsed = nonNegativeInteger(value, field, 0);
  if (parsed <= 0) throw new Error(`${field} must be greater than zero`);
  return parsed;
}

function firstPassYieldBps(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const percentSuffix = normalized.endsWith("%");
  const numericText = percentSuffix ? normalized.slice(0, -1).trim() : normalized;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(numericText)) {
    throw new Error("first_pass_yield must be a ratio, percentage, or percent-suffixed value");
  }

  const numeric = Number(numericText);
  const ratio = percentSuffix ? numeric / 100 : numeric <= 1 ? numeric : numeric / 100;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error("first_pass_yield must resolve to a value between 0% and 100%");
  }
  return Math.round(ratio * 10_000);
}

function manufacturedOn(value: string | undefined): string {
  const normalized = requiredText(value, "manufactured_on", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error("manufactured_on must use YYYY-MM-DD");
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error("manufactured_on must be a real calendar date");
  }
  return normalized;
}

function rowObject(headers: readonly string[], values: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, header] of headers.entries()) result[header] = values[index] ?? "";
  return result;
}

function parseDefect(row: Readonly<Record<string, string>>): ProductionBatchDefect | undefined {
  const rawCategory = row.defect_kind?.trim().toLowerCase().replaceAll("-", "_");
  const rawCode = row.defect_code?.trim();
  const rawCount = row.defect_count?.trim();
  const rawNotes = row.defect_notes?.trim();

  if (!rawCategory && !rawCode && !rawCount && !rawNotes) return undefined;
  if (!rawCategory || !defectCategories.has(rawCategory as ProductionDefectCategory)) {
    throw new Error("defect_kind must be one of aoi, spi, functional_test, ncr, or rma");
  }

  const notes = boundedText(rawNotes, "defect_notes", 2_000);
  return {
    category: rawCategory as ProductionDefectCategory,
    code: requiredText(rawCode, "defect_code", 128),
    count: positiveInteger(rawCount, "defect_count"),
    ...(notes ? { notes } : {}),
  };
}

function comparableBatch(batch: ProductionBatchInput): string {
  return JSON.stringify({
    externalBatchId: batch.externalBatchId,
    manufacturer: batch.manufacturer,
    manufacturedOn: batch.manufacturedOn,
    quantity: batch.quantity,
    firstPassYieldBps: batch.firstPassYieldBps ?? null,
    reworkCount: batch.reworkCount,
    scrapCount: batch.scrapCount,
    notes: batch.notes ?? null,
    correctiveAction: batch.correctiveAction ?? null,
  });
}

export function parseProductionOutcomeCsv(text: string): ParsedProductionOutcomeCsv {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) throw new Error("Production outcome CSV is empty");

  const headers = rows[0]?.map(normalizedHeader) ?? [];
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    if (!header) throw new Error("Production outcome CSV contains a blank header");
    if (seenHeaders.has(header)) throw new Error(`Production outcome CSV contains duplicate header "${header}"`);
    seenHeaders.add(header);
  }
  for (const header of requiredHeaders) {
    if (!seenHeaders.has(header)) throw new Error(`Production outcome CSV is missing required header "${header}"`);
  }

  const batches = new Map<string, ProductionBatchInput>();

  for (const [index, values] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    if (values.length > headers.length) throw new Error(`CSV row ${rowNumber} has more cells than the header`);
    const row = rowObject(headers, values);
    const externalBatchId = requiredText(row.batch_id, "batch_id", 160);
    const manufacturer = requiredText(row.manufacturer, "manufacturer", 200);
    const notes = boundedText(row.notes, "notes", 4_000);
    const correctiveAction = boundedText(row.corrective_action, "corrective_action", 4_000);
    const batch: ProductionBatchInput = {
      externalBatchId,
      manufacturer,
      manufacturedOn: manufacturedOn(row.manufactured_on),
      quantity: positiveInteger(row.quantity, "quantity"),
      firstPassYieldBps: firstPassYieldBps(row.first_pass_yield),
      reworkCount: nonNegativeInteger(row.rework_count, "rework_count"),
      scrapCount: nonNegativeInteger(row.scrap_count, "scrap_count"),
      ...(notes ? { notes } : {}),
      ...(correctiveAction ? { correctiveAction } : {}),
      defects: [],
    };

    const key = `${manufacturer.toLowerCase()}\u0000${externalBatchId.toLowerCase()}`;
    const existing = batches.get(key);
    if (existing) {
      if (comparableBatch(existing) !== comparableBatch(batch)) {
        throw new Error(`CSV row ${rowNumber} changes metadata for batch "${externalBatchId}"`);
      }
    } else {
      batches.set(key, batch);
    }

    const target = batches.get(key);
    if (!target) throw new Error("Production outcome batch normalization failed");

    const defect = parseDefect(row);
    if (!defect) continue;
    if (
      target.defects.some(
        (entry) => entry.category === defect.category && entry.code.toLowerCase() === defect.code.toLowerCase(),
      )
    ) {
      throw new Error(`CSV row ${rowNumber} duplicates defect ${defect.category}:${defect.code}`);
    }
    (target.defects as ProductionBatchDefect[]).push(defect);
  }

  if (batches.size === 0) throw new Error("Production outcome CSV has no data rows");

  return {
    sourceSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    batches: [...batches.values()],
  };
}
