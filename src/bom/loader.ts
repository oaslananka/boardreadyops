import { parseDelimitedRows } from "../util/delimited.js";
import { readTextFile } from "../util/fs.js";
import { normalizeBomRows } from "./normalizer.js";
import type { BomRow } from "./types.js";

export async function loadBom(file: string): Promise<BomRow[]> {
  const text = await readTextFile(file);
  const delimiter = file.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  return normalizeBomRows(parseDelimited(text, delimiter), file);
}

export function parseDelimited(text: string, delimiter = ","): Record<string, string>[] {
  const rows = parseDelimitedRows(text, delimiter);
  const rawHeader = rows.shift()?.map((cell) => cell.trim()) ?? [];
  const header = dedupeHeaderNames(rawHeader);
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]?.trim() ?? ""])));
}

/**
 * A malformed export can repeat a column name (e.g. two "Value" columns). Object.fromEntries
 * keeps only the last entry for a repeated key, which would silently drop the first duplicate
 * column's data. Keep the first occurrence under its original name -- so existing lookups by
 * known header names are unaffected -- and suffix later duplicates instead of overwriting them.
 */
function dedupeHeaderNames(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}
