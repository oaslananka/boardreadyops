/**
 * BOM document parsing and manipulation helpers for the fix subsystem.
 *
 * Extracted from fixes.ts to keep the fix-plan module focused on
 * orchestration rather than delimited-file mechanics.
 */

import type { BoardReadyOpsConfig } from "../core/config.js";
import { parseDelimitedRows } from "../util/delimited.js";

export interface BomTarget {
  path: string;
  project?: ConfigProject;
}

export interface DelimitedDocument {
  delimiter: string;
  header: string[];
  rows: string[][];
}

type ConfigProject = NonNullable<BoardReadyOpsConfig["projects"]>[number];

/**
 * Parse a delimited document (CSV or TSV) from text.
 */
export function parseDelimitedDocument(text: string, file: string): DelimitedDocument {
  const delimiter = file.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const rows = parseDelimitedRows(text, delimiter);
  const header = rows.shift()?.map((cell) => cell.trim()) ?? [];
  const width = header.length;
  return {
    delimiter,
    header,
    rows: rows
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .map((row) => Array.from({ length: Math.max(width, row.length) }, (_, index) => row[index]?.trim() ?? "")),
  };
}

/**
 * Serialize a delimited document back to text.
 */
export function writeDelimitedDocument(document: DelimitedDocument): string {
  return [document.header, ...document.rows]
    .map((row) => row.map((cell) => encodeCell(cell, document.delimiter)).join(document.delimiter))
    .join("\n")
    .concat("\n");
}

function encodeCell(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes("\n") || value.includes("\r") || value.includes(delimiter)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Ensure a column exists in the header, adding it if missing.
 */
export function ensureColumn(header: string[], aliases: string[]): number {
  const existing = indexByAliases(header, aliases);
  if (existing >= 0) {
    return existing;
  }
  header.push("MPN");
  return header.length - 1;
}

/**
 * Get a field value by header alias.
 */
export function fieldByAliases(header: string[], row: string[], aliases: string[]): string {
  const index = indexByAliases(header, aliases);
  return index >= 0 ? cellAt(row, index) : "";
}

function indexByAliases(header: string[], aliases: string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return header.findIndex((entry) => normalizedAliases.has(normalizeHeader(entry)));
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function cellAt(row: string[], index: number): string {
  return row[index]?.trim() ?? "";
}

/**
 * Test whether a field value represents a DNP (do-not-populate) state.
 */
export function isDnpValue(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/^(false|no|0)$/i.test(value)) {
    return false;
  }
  return /^(true|yes|1|dnp|do not populate|not fitted)$/i.test(value);
}
