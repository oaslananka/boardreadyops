import { createHash } from "node:crypto";
import { DelimitedParseError, parseDelimitedRows } from "./delimited.js";

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

export type ParsedProductionOutcomeJson = {
  sourceSha256: string;
  batch: ProductionBatchInput;
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

  try {
    return parseDelimitedRows(text, ",", {
      maxRows: maximumRows + 1,
      maxColumns: maximumColumns,
      maxCellLength: maximumCellLength,
      rejectUnterminatedQuote: true,
    });
  } catch (error) {
    if (!(error instanceof DelimitedParseError)) throw error;
    if (error.code === "cell_limit") {
      throw new Error("Production outcome CSV cell exceeds 4000 characters");
    }
    if (error.code === "column_limit") {
      throw new Error("Production outcome CSV exceeds 64 columns");
    }
    if (error.code === "row_limit") {
      throw new Error("Production outcome CSV exceeds 10000 data rows");
    }
    throw new Error("Production outcome CSV contains an unterminated quoted field");
  }
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
    throw new Error("first_pass_yield must be a ratio or percent-suffixed value");
  }

  const numeric = Number(numericText);
  if (!Number.isFinite(numeric)) {
    throw new Error("first_pass_yield must be a ratio or percent-suffixed value");
  }

  if (percentSuffix) {
    if (numeric < 0 || numeric > 100) {
      throw new Error("first_pass_yield percentage must be between 0% and 100%");
    }
    return Math.round(numeric * 100);
  }

  if (numeric < 0 || numeric > 1) {
    throw new Error("first_pass_yield without % must be a ratio between 0 and 1; append % for percentages");
  }
  return Math.round(numeric * 10_000);
}

function manufacturedOn(value: string | undefined, field = "manufactured_on"): string {
  const normalized = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${field} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${field} must be a real calendar date`);
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
    if (target.defects.some((entry) => entry.category === defect.category && entry.code === defect.code)) {
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

const jsonBatchFields = new Set([
  "externalBatchId",
  "manufacturer",
  "manufacturedOn",
  "quantity",
  "firstPassYieldBps",
  "reworkCount",
  "scrapCount",
  "notes",
  "correctiveAction",
  "defects",
]);

const jsonDefectFields = new Set(["category", "code", "count", "notes"]);

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Production outcome JSON ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownJsonFields(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(record)
    .filter((key) => !allowed.has(key))
    .sort()[0];
  if (unknown) throw new Error(`Production outcome JSON ${label} contains unsupported field "${unknown}"`);
}

function jsonString(
  value: unknown,
  field: string,
  maximum: number,
  options: { required?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) throw new Error(`Production outcome JSON ${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`Production outcome JSON ${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) {
    if (options.required) throw new Error(`Production outcome JSON ${field} is required`);
    return undefined;
  }
  if (normalized.length > maximum) {
    throw new Error(`Production outcome JSON ${field} exceeds ${maximum} characters`);
  }
  return normalized;
}

function jsonInteger(
  value: unknown,
  field: string,
  options: { required?: boolean; minimum?: number; maximum?: number; fallback?: number } = {},
): number | undefined {
  if (value === undefined || value === null) {
    if (options.required) throw new Error(`Production outcome JSON ${field} is required`);
    return options.fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Production outcome JSON ${field} must be a safe integer`);
  }
  const minimum = options.minimum ?? 0;
  if (value < minimum) throw new Error(`Production outcome JSON ${field} must be at least ${minimum}`);
  if (options.maximum !== undefined && value > options.maximum) {
    throw new Error(`Production outcome JSON ${field} must be at most ${options.maximum}`);
  }
  return value;
}

function parseJsonDefect(value: unknown, index: number): ProductionBatchDefect {
  const label = `defects[${index}]`;
  const record = jsonRecord(value, label);
  rejectUnknownJsonFields(record, jsonDefectFields, label);

  const rawCategory = jsonString(record.category, `${label}.category`, 32, { required: true });
  if (!rawCategory || !defectCategories.has(rawCategory as ProductionDefectCategory)) {
    throw new Error(`Production outcome JSON ${label}.category must be one of aoi, spi, functional_test, ncr, or rma`);
  }
  const code = jsonString(record.code, `${label}.code`, 128, { required: true });
  const count = jsonInteger(record.count, `${label}.count`, { required: true, minimum: 1 });
  const notes = jsonString(record.notes, `${label}.notes`, 2_000);
  if (!code || count === undefined) throw new Error(`Production outcome JSON ${label} is incomplete`);
  return {
    category: rawCategory as ProductionDefectCategory,
    code,
    count,
    ...(notes ? { notes } : {}),
  };
}

export function parseProductionOutcomeJson(text: string): ParsedProductionOutcomeJson {
  if (Buffer.byteLength(text, "utf8") > maximumCsvBytes) {
    throw new Error("Production outcome JSON exceeds the 2 MiB import limit");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Production outcome JSON is malformed");
  }

  const record = jsonRecord(value, "batch");
  rejectUnknownJsonFields(record, jsonBatchFields, "batch");

  const externalBatchId = jsonString(record.externalBatchId, "externalBatchId", 160, { required: true });
  const manufacturer = jsonString(record.manufacturer, "manufacturer", 200, { required: true });
  const manufacturedOnInput = jsonString(record.manufacturedOn, "manufacturedOn", 10, { required: true });
  const quantity = jsonInteger(record.quantity, "quantity", { required: true, minimum: 1 });
  const firstPassYieldBps = jsonInteger(record.firstPassYieldBps, "firstPassYieldBps", {
    minimum: 0,
    maximum: 10_000,
  });
  const reworkCount = jsonInteger(record.reworkCount, "reworkCount", { minimum: 0, fallback: 0 });
  const scrapCount = jsonInteger(record.scrapCount, "scrapCount", { minimum: 0, fallback: 0 });
  const notes = jsonString(record.notes, "notes", 4_000);
  const correctiveAction = jsonString(record.correctiveAction, "correctiveAction", 4_000);

  const rawDefects = record.defects ?? [];
  if (!Array.isArray(rawDefects)) throw new Error("Production outcome JSON defects must be an array");
  if (rawDefects.length > 1_000) throw new Error("Production outcome JSON exceeds the 1000-defect import limit");

  const defects = rawDefects.map(parseJsonDefect);
  const seenDefects = new Set<string>();
  for (const defect of defects) {
    const key = `${defect.category}\u0000${defect.code}`;
    if (seenDefects.has(key)) {
      throw new Error(`Production outcome JSON duplicates defect ${defect.category}:${defect.code}`);
    }
    seenDefects.add(key);
  }

  if (!externalBatchId || !manufacturer || !manufacturedOnInput || quantity === undefined) {
    throw new Error("Production outcome JSON batch is incomplete");
  }

  return {
    sourceSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    batch: {
      externalBatchId,
      manufacturer,
      manufacturedOn: manufacturedOn(manufacturedOnInput, "manufacturedOn"),
      quantity,
      ...(firstPassYieldBps === undefined ? {} : { firstPassYieldBps }),
      reworkCount: reworkCount ?? 0,
      scrapCount: scrapCount ?? 0,
      ...(notes ? { notes } : {}),
      ...(correctiveAction ? { correctiveAction } : {}),
      defects,
    },
  };
}
