import { splitRefs } from "../util/strings.js";
import { type BomFieldProvenance, stableComponentKey } from "./identity.js";
import type { BomRow } from "./types.js";

const aliases: Record<
  keyof Pick<BomRow, "reference" | "value" | "footprint" | "manufacturer" | "mpn" | "lifecycle" | "compliance">,
  string[]
> = {
  reference: ["reference", "refs", "ref", "designator", "references"],
  value: ["value", "part", "description"],
  footprint: ["footprint", "package", "pcb footprint"],
  manufacturer: ["manufacturer", "mfr", "maker"],
  mpn: ["mpn", "manufacturer part number", "mfr part number", "part number", "manufacturer_part_number"],
  lifecycle: ["lifecycle", "status", "availability"],
  compliance: ["compliance", "rohs", "reach", "rohs status", "rohs/reach", "environmental"],
};

export function normalizeBomRows(rows: Record<string, string>[], sourcePath: string): BomRow[] {
  const output: BomRow[] = [];
  for (const [index, raw] of rows.entries()) {
    const normalized = normalizedMap(raw);
    const referenceValue = getFieldWithSource(normalized, aliases.reference);
    if (!referenceValue) {
      continue;
    }
    const refs = splitRefs(referenceValue.value);
    const quantity = Number(getField(normalized, ["quantity", "qty"]));
    const suppliers = supplierValues(raw);

    const provenanceFields = buildProvenance(normalized);

    for (const reference of refs) {
      const mpn = getField(normalized, aliases.mpn);
      const manufacturer = getField(normalized, aliases.manufacturer);
      output.push({
        reference,
        value: getField(normalized, aliases.value),
        footprint: getField(normalized, aliases.footprint),
        manufacturer,
        mpn,
        suppliers,
        lifecycle: getField(normalized, aliases.lifecycle),
        compliance: getField(normalized, aliases.compliance),
        dnp: isDnp(getField(normalized, ["dnp", "do not populate", "populate"])),
        sourcePath,
        sourceKind: "bom",
        line: index + 2,
        raw,
        groupedReferences: refs,
        quantity: Number.isFinite(quantity) ? quantity : undefined,
        provenance: provenanceFields,
        identityKey: stableComponentKey(reference, mpn, manufacturer),
      });
    }
  }
  return output;
}

function normalizedMap(raw: Record<string, string>): Map<string, { value: string; sourceField: string }> {
  return new Map(
    Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase(), { value: value.trim(), sourceField: key }]),
  );
}

function getField(
  normalized: Map<string, { value: string; sourceField: string }>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const entry = normalized.get(name);
    if (entry?.value) {
      return entry.value;
    }
  }
  return undefined;
}

function getFieldWithSource(
  normalized: Map<string, { value: string; sourceField: string }>,
  names: string[],
): { value: string; sourceField: string } | undefined {
  for (const name of names) {
    const entry = normalized.get(name);
    if (entry?.value) {
      return entry;
    }
  }
  return undefined;
}

function buildProvenance(normalized: Map<string, { value: string; sourceField: string }>): BomFieldProvenance[] {
  const provenance: BomFieldProvenance[] = [];
  const fieldAliases = Object.entries(aliases) as [keyof typeof aliases, string[]][];
  for (const [field, names] of fieldAliases) {
    for (const name of names) {
      const entry = normalized.get(name);
      if (entry?.value) {
        provenance.push({ field, sourceField: entry.sourceField });
        break;
      }
    }
  }
  return provenance;
}

function supplierValues(row: Record<string, string>): string[] {
  return Object.entries(row)
    .filter(([key, value]) => /supplier|vendor|distributor/i.test(key) && value.trim() !== "")
    .map(([, value]) => value.trim());
}

function isDnp(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  if (/^(false|no|0|yes)$/i.test(value) && !/^yes$/i.test(value)) {
    return false;
  }
  return /^(true|yes|1|dnp|do not populate|not fitted)$/i.test(value);
}
