export type DelimitedParseErrorCode = "cell_limit" | "column_limit" | "row_limit" | "unterminated_quote";

export class DelimitedParseError extends Error {
  readonly code: DelimitedParseErrorCode;

  constructor(code: DelimitedParseErrorCode, message: string) {
    super(message);
    this.name = "DelimitedParseError";
    this.code = code;
  }
}

export type DelimitedParseOptions = {
  maxRows?: number;
  maxColumns?: number;
  maxCellLength?: number;
  rejectUnterminatedQuote?: boolean;
};

function positiveLimit(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/**
 * Parses RFC-4180-style quoted delimited text.
 *
 * The default mode intentionally remains permissive for existing BOM/centroid importers:
 * unterminated quotes are returned as the final cell and no size limits are imposed. Callers
 * processing untrusted uploads can opt into strict quote handling and bounded rows/columns/cells.
 */
export function parseDelimitedRows(text: string, delimiter: string, options: DelimitedParseOptions = {}): string[][] {
  if (delimiter.length !== 1) throw new Error("delimiter must be exactly one character");

  const maxRows = positiveLimit(options.maxRows, "maxRows");
  const maxColumns = positiveLimit(options.maxColumns, "maxColumns");
  const maxCellLength = positiveLimit(options.maxCellLength, "maxCellLength");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const append = (value: string) => {
    cell += value;
    if (maxCellLength !== undefined && cell.length > maxCellLength) {
      throw new DelimitedParseError("cell_limit", `Delimited cell exceeds ${maxCellLength} characters`);
    }
  };

  const pushCell = () => {
    row.push(cell);
    cell = "";
    if (maxColumns !== undefined && row.length > maxColumns) {
      throw new DelimitedParseError("column_limit", `Delimited row exceeds ${maxColumns} columns`);
    }
  };

  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (maxRows !== undefined && rows.length > maxRows) {
      throw new DelimitedParseError("row_limit", `Delimited input exceeds ${maxRows} rows`);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        append('"');
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        append(char ?? "");
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushCell();
    } else if (char === "\n") {
      cell = cell.replace(/\r$/u, "");
      pushRow();
    } else {
      append(char ?? "");
    }
  }

  if (quoted && options.rejectUnterminatedQuote === true) {
    throw new DelimitedParseError("unterminated_quote", "Delimited input contains an unterminated quoted field");
  }

  if (cell.length > 0 || row.length > 0 || !text.endsWith("\n")) {
    cell = cell.replace(/\r$/u, "");
    pushRow();
  }

  return rows;
}
