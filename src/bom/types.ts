import type { BomFieldProvenance } from "./identity.js";

export interface BomRow {
  reference: string;
  value?: string | undefined;
  footprint?: string | undefined;
  manufacturer?: string | undefined;
  mpn?: string | undefined;
  suppliers?: string[] | undefined;
  lifecycle?: string | undefined;
  compliance?: string | undefined;
  dnp?: boolean | undefined;
  sourcePath: string;
  sourceKind: "bom" | "schematic";
  line?: number | undefined;
  raw?: Record<string, string> | undefined;
  groupedReferences?: string[] | undefined;
  quantity?: number | undefined;
  /** Source-field provenance for each normalized field present in this row. */
  provenance?: BomFieldProvenance[] | undefined;
  /**
   * Stable 16-hex identity key derived from `reference`, `mpn`, and `manufacturer`.
   * Survives row reordering and column renaming.
   */
  identityKey?: string | undefined;
}
