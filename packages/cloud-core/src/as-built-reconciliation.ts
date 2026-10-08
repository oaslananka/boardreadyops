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
const sha256 = /^[a-f0-9]{64}$/iu;
const commitSha = /^[a-f0-9]{40}$/iu;

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`${label} must be a bounded nonempty identity`);
  return normalized;
}

function partIdentity(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.toLocaleUpperCase("en-US") : undefined;
}

function normalizedReference(value: string): string {
  return requiredIdentity(value, "BOM reference").toLocaleUpperCase("en-US");
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
    indexed.set(key, part);
  }
  return indexed;
}

function listedCandidatePolicy(
  primary: BomPart,
  actual: BomPart,
  alternates: readonly DocumentedAlternate[],
): string | undefined {
  const from = partIdentity(primary.mpn);
  const to = partIdentity(actual.mpn);
  if (!from || !to) return undefined;
  const matching = alternates.filter(
    (alternate) =>
      partIdentity(alternate.primaryMpn) === from &&
      partIdentity(alternate.alternateMpn) === to &&
      (!alternate.alternateManufacturer ||
        partIdentity(alternate.alternateManufacturer) === partIdentity(actual.manufacturer)),
  );
  // An ambiguous policy mapping is not a single authorized substitution.
  if (matching.length !== 1) return undefined;
  return requiredIdentity(matching[0]?.policyId ?? "", "Alternate policy");
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
  alternates: readonly DocumentedAlternate[],
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

/**
 * Reconcile two externally supplied BOM lists against explicit release/batch IDs.
 * Caller must independently authenticate input manifests, batch provenance and
 * any manufacturer approval before treating these records as shipped truth.
 */
export function compareApprovedAndBuiltBom(input: AsBuiltComparisonInput): AsBuiltComparison {
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
  const alternates = input.documentedAlternates ?? [];
  if (alternates.length > maximumAlternates) throw new Error("Approved alternate list exceeds the supported limit");
  const approved = partIndex(input.approved, "Approved BOM");
  const built = partIndex(input.built, "As-built BOM");
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

  return {
    releaseId: input.approvedRelease.id,
    repositoryId: input.approvedRelease.repositoryId,
    approvedCommitSha: input.approvedRelease.commitSha,
    approvedSnapshotId: input.approvedRelease.snapshotId,
    batchId: input.productionBatch.id,
    externalBatchId: input.productionBatch.externalBatchId,
    batchSourceSha256: input.productionBatch.sourceSha256,
    divergences,
    status: divergences.some((entry) => entry.kind === "identity_incomplete")
      ? "insufficient_identity"
      : divergences.length > 0
        ? "different_records"
        : "matching_records",
  };
}
