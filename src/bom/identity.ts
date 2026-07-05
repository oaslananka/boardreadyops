import crypto from "node:crypto";

/**
 * Tracks the mapping from a normalized `BomRow` field to the raw source column.
 * Used in diagnostics to explain which CSV column provided each identity field.
 */
export interface BomFieldProvenance {
  /** Normalized field name on `BomRow` (e.g. `"mpn"`, `"manufacturer"`). */
  field: string;
  /** Raw CSV column header that was matched (e.g. `"manufacturer_part_number"`). */
  sourceField: string;
}

/**
 * A stable, order-independent identity key for a BOM component.
 *
 * The key is a 16-hex-character prefix of `SHA-256(reference|mpn|manufacturer)`
 * after lowercasing and stripping whitespace, so it survives BOM row reordering.
 */
export function stableComponentKey(
  reference: string,
  mpn: string | undefined,
  manufacturer: string | undefined,
): string {
  const parts = [
    reference.trim().toLowerCase(),
    (mpn ?? "").trim().toLowerCase(),
    (manufacturer ?? "").trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex").slice(0, 16);
}
