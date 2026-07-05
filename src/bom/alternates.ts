/**
 * Approved alternate part definitions for BOM supply chain risk management.
 *
 * An alternate entry documents that a specific primary MPN has one or more
 * tested and approved substitute parts, so single-source risk findings can
 * distinguish an actively managed single-source decision from an oversight.
 */

export interface BomAlternate {
  /** Manufacturer part number of the approved alternate. */
  mpn: string;
  /** Manufacturer of the approved alternate (optional, informational). */
  manufacturer?: string | undefined;
  /** Free-form note, e.g. "Verified compatible at Rev1 prototype". */
  note?: string | undefined;
}

export interface BomAlternateEntry {
  /** Primary MPN this alternate list applies to. */
  mpn: string;
  /** One or more approved substitute parts. */
  alts: BomAlternate[];
}

/**
 * Build a lookup map from primary MPN to its approved alternates.
 * The map uses upper-cased, trimmed MPN keys for case-insensitive lookup.
 */
export function buildAlternatesMap(entries: BomAlternateEntry[]): Map<string, BomAlternate[]> {
  const map = new Map<string, BomAlternate[]>();
  for (const entry of entries) {
    if (entry.mpn && entry.alts.length > 0) {
      map.set(entry.mpn.trim().toUpperCase(), entry.alts);
    }
  }
  return map;
}

/**
 * Returns true if the given MPN has at least one approved alternate defined.
 */
export function hasApprovedAlternates(mpn: string, map: Map<string, BomAlternate[]>): boolean {
  return map.has(mpn.trim().toUpperCase());
}
