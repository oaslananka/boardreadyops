/** Storage-neutral comparison only: input identity/authorization is NOT independently verified. */
export type BomPart = {
  reference: string;
  mpn?: string | undefined;
  manufacturer?: string | undefined;
  footprint?: string | undefined;
  quantity?: number | undefined;
  dnp?: boolean | undefined;
};

export type DocumentedAlternate = {
  primaryMpn: string;
  alternateMpn: string;
  alternateManufacturer?: string | undefined;
  policyId: string;
};

export type AsBuiltComparisonInput = {
  approvedRelease: { id: string; repositoryId: string; commitSha: string; snapshotId: string };
  productionBatch: { id: string; externalBatchId: string; sourceSha256: string };
  approved: readonly BomPart[];
  built: readonly BomPart[];
  documentedAlternates?: readonly DocumentedAlternate[] | undefined;
};

export type BomDivergenceKind =
  | "additional_part"
  | "footprint_difference"
  | "identity_incomplete"
  | "missing_populated_part"
  | "part_substitution"
  | "quantity_difference"
  | "unexpected_assembly";

export type BomDivergence = {
  reference: string;
  kind: BomDivergenceKind;
  approved?: BomPart | undefined;
  built?: BomPart | undefined;
  /** A documented candidate is not proof that a batch substitution was authorized. */
  candidatePolicyId?: string | undefined;
};

export type AsBuiltComparison = {
  releaseId: string;
  repositoryId: string;
  approvedCommitSha: string;
  approvedSnapshotId: string;
  batchId: string;
  externalBatchId: string;
  batchSourceSha256: string;
  /** A diff of supplied records, never proof of shipment composition or compliance. */
  divergences: readonly BomDivergence[];
  /** Missing identities or quantities must not be represented as a clean match. */
  status: "matching_records" | "different_records" | "insufficient_identity";
};

const maximumParts = 5_000;
const maximumAlternates = 5_000;
// Use one canonical identity representation across batch, release and graph
// records. A different case must not become a distinct lookup/attestation key.
const sha256 = /^[a-f0-9]{64}$/u;
const commitSha = /^[a-f0-9]{40}$/u;

function invalidBoundedText(value: unknown): boolean {
  return typeof value !== "string" || value.length > 256 || value.includes("\0");
}

function requiredIdentity(value: string, label: string): string {
  // Share raw length/type/null-byte checks with optional BOM fields: trimming
  // must not turn an oversized alternate into a supposedly valid identity.
  if (invalidBoundedText(value) || !value.trim()) {
    throw new Error(`${label} must be a bounded nonempty identity`);
  }
  return value.trim();
}

function partIdentity(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.toLocaleUpperCase("en-US") : undefined;
}

function normalizedReference(value: string): string {
  return requiredIdentity(value, "BOM reference").toLocaleUpperCase("en-US");
}

function validatePartField(value: string | undefined, label: string): void {
  if (value !== undefined && invalidBoundedText(value)) {
    throw new Error(`${label} must be a bounded text field`);
  }
}

function partIndex(parts: readonly BomPart[], label: string): Map<string, BomPart> {
  if (parts.length > maximumParts) throw new Error(`${label} exceeds the supported component limit`);
  const indexed = new Map<string, BomPart>();
  for (const part of parts) {
    const key = normalizedReference(part.reference);
    if (indexed.has(key)) throw new Error(`${label} contains duplicate BOM reference ${key}`);
    if (part.quantity !== undefined && (!Number.isSafeInteger(part.quantity) || part.quantity <= 0)) {
      throw new Error(`${label} has invalid quantity for ${key}`);
    }
    if (part.dnp !== undefined && typeof part.dnp !== "boolean") {
      throw new Error(`${label} has invalid DNP flag for ${key}`);
    }
    for (const field of ["mpn", "manufacturer", "footprint"] as const) {
      validatePartField(part[field], `${label} ${key} ${field}`);
    }
    indexed.set(key, part);
  }
  return indexed;
}

type AlternateIndex = ReadonlyMap<string, { count: number; policyId: string }>;

function requiredPartIdentity(value: string, label: string): string {
  return requiredIdentity(value, label).toLocaleUpperCase("en-US");
}

function alternateKey(primaryMpn: string, alternateMpn: string, manufacturer?: string): string {
  return JSON.stringify([primaryMpn, alternateMpn, manufacturer ?? null]);
}

function indexDocumentedAlternates(alternates: readonly DocumentedAlternate[]): AlternateIndex {
  const indexed = new Map<string, { count: number; policyId: string }>();
  for (const alternate of alternates) {
    const primaryMpn = requiredPartIdentity(alternate.primaryMpn, "Alternate primary MPN");
    const alternateMpn = requiredPartIdentity(alternate.alternateMpn, "Alternate MPN");
    const alternateManufacturer =
      alternate.alternateManufacturer === undefined
        ? undefined
        : requiredPartIdentity(alternate.alternateManufacturer, "Alternate manufacturer");
    const policyId = requiredIdentity(alternate.policyId, "Alternate policy");
    const key = alternateKey(primaryMpn, alternateMpn, alternateManufacturer);
    const previous = indexed.get(key);
    indexed.set(key, { count: (previous?.count ?? 0) + 1, policyId });
  }
  return indexed;
}

function listedCandidatePolicy(primary: BomPart, actual: BomPart, alternates: AlternateIndex): string | undefined {
  const from = partIdentity(primary.mpn);
  const to = partIdentity(actual.mpn);
  if (!from || !to) return undefined;
  const general = alternates.get(alternateKey(from, to));
  const manufacturer = partIdentity(actual.manufacturer);
  const specific = manufacturer ? alternates.get(alternateKey(from, to, manufacturer)) : undefined;
  // Both a general and manufacturer-specific entry (or duplicates) are ambiguous.
  const matches = (general?.count ?? 0) + (specific?.count ?? 0);
  return matches === 1 ? (specific?.policyId ?? general?.policyId) : undefined;
}

function addDifference(
  divergences: BomDivergence[],
  reference: string,
  kind: BomDivergenceKind,
  approved?: BomPart,
  built?: BomPart,
  candidatePolicyId?: string,
): void {
  divergences.push({
    reference,
    kind,
    ...(approved ? { approved } : {}),
    ...(built ? { built } : {}),
    ...(candidatePolicyId ? { candidatePolicyId } : {}),
  });
}

function comparePopulatedPart(
  reference: string,
  approved: BomPart,
  built: BomPart,
  alternates: AlternateIndex,
  divergences: BomDivergence[],
): void {
  const approvedMpn = partIdentity(approved.mpn);
  const builtMpn = partIdentity(built.mpn);
  const approvedManufacturer = partIdentity(approved.manufacturer);
  const builtManufacturer = partIdentity(built.manufacturer);
  if (!approvedMpn || !builtMpn || !approvedManufacturer || !builtManufacturer) {
    addDifference(divergences, reference, "identity_incomplete", approved, built);
  } else if (approvedMpn !== builtMpn || approvedManufacturer !== builtManufacturer) {
    const policy = listedCandidatePolicy(approved, built, alternates);
    addDifference(divergences, reference, "part_substitution", approved, built, policy);
  }
  const approvedFootprint = partIdentity(approved.footprint);
  const builtFootprint = partIdentity(built.footprint);
  if (Boolean(approvedFootprint) !== Boolean(builtFootprint)) {
    addDifference(divergences, reference, "identity_incomplete", approved, built);
  } else if (approvedFootprint !== builtFootprint) {
    addDifference(divergences, reference, "footprint_difference", approved, built);
  }
  if (approved.quantity === undefined || built.quantity === undefined) {
    addDifference(divergences, reference, "identity_incomplete", approved, built);
  } else if (approved.quantity !== built.quantity) {
    addDifference(divergences, reference, "quantity_difference", approved, built);
  }
}

function validateComparisonInput(input: AsBuiltComparisonInput): void {
  const identities: readonly (readonly [string, string])[] = [
    [input.approvedRelease.id, "Approved release"],
    [input.approvedRelease.repositoryId, "Repository"],
    [input.approvedRelease.snapshotId, "BOM snapshot"],
    [input.productionBatch.id, "Production batch"],
    [input.productionBatch.externalBatchId, "External batch"],
  ];
  for (const [value, label] of identities) requiredIdentity(value, label);
  if (!commitSha.test(input.approvedRelease.commitSha))
    throw new Error("Approved commit SHA must be 40 hexadecimal characters");
  if (!sha256.test(input.productionBatch.sourceSha256))
    throw new Error("Batch source digest must be 64 hexadecimal characters");
  if ((input.documentedAlternates?.length ?? 0) > maximumAlternates)
    throw new Error("Approved alternate list exceeds the supported limit");
}

function collectBomDifferences(
  approved: ReadonlyMap<string, BomPart>,
  built: ReadonlyMap<string, BomPart>,
  alternates: AlternateIndex,
): BomDivergence[] {
  const divergences: BomDivergence[] = [];
  const references = new Set([...approved.keys(), ...built.keys()]);
  for (const reference of [...references].sort((a, b) => a.localeCompare(b))) {
    const design = approved.get(reference);
    const actual = built.get(reference);
    if (design?.dnp === true) {
      if (actual && actual.dnp !== true) addDifference(divergences, reference, "unexpected_assembly", design, actual);
    } else if (!design && actual && actual.dnp !== true) {
      addDifference(divergences, reference, "additional_part", undefined, actual);
    } else if (design && (!actual || actual.dnp === true)) {
      addDifference(divergences, reference, "missing_populated_part", design);
    } else if (design && actual) {
      comparePopulatedPart(reference, design, actual, alternates, divergences);
    }
  }
  return divergences;
}

/**
 * Reconcile two externally supplied BOM lists against explicit release/batch IDs.
 * Caller must independently authenticate input manifests, batch provenance and
 * any manufacturer approval before treating these records as shipped truth.
 */
export function compareApprovedAndBuiltBom(input: AsBuiltComparisonInput): AsBuiltComparison {
  validateComparisonInput(input);
  const approved = partIndex(input.approved, "Approved BOM");
  const built = partIndex(input.built, "As-built BOM");
  // Validate all alternate records, even ones not selected for this batch, and
  // index candidates once instead of scanning the list for every substitution.
  const alternatives = indexDocumentedAlternates(input.documentedAlternates ?? []);
  const divergences = collectBomDifferences(approved, built, alternatives);
  // An all-DNP design has no populated baseline to establish an as-built match.
  const hasPopulatedApprovedPart = input.approved.some((part) => part.dnp !== true);

  return {
    releaseId: input.approvedRelease.id,
    repositoryId: input.approvedRelease.repositoryId,
    approvedCommitSha: input.approvedRelease.commitSha,
    approvedSnapshotId: input.approvedRelease.snapshotId,
    batchId: input.productionBatch.id,
    externalBatchId: input.productionBatch.externalBatchId,
    batchSourceSha256: input.productionBatch.sourceSha256,
    divergences,
    status:
      !hasPopulatedApprovedPart || divergences.some((entry) => entry.kind === "identity_incomplete")
        ? "insufficient_identity"
        : divergences.length > 0
          ? "different_records"
          : "matching_records",
  };
}
