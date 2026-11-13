/**
 * Browser preview of an opt-in, local CLI Review bundle. The preview is not
 * proof that hardware is manufacturable; all publication and repository
 * authorization still happen on the server with the user's GitHub session.
 */
export const reviewBundleLimitBytes = 64 * 1024 * 1024;

type RecordValue = Record<string, unknown>;

export interface ParsedReviewBundle {
  repository: string;
  commitSha: string;
  evidenceDigest: string;
  title: string;
  idempotencyKey: string;
  findingCount: number;
  blockingCount: number;
  nativePcbViews: number;
  nativeSchematicViews: number;
  includesDesignArtwork: boolean;
  payload: RecordValue;
}

const repositoryPattern = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu;
const sha40 = /^[a-f0-9]{40}$/u;
const sha64 = /^[a-f0-9]{64}$/u;
const permittedPayloadKeys = new Set([
  "repositoryId",
  "commitSha",
  "ref",
  "triggerKind",
  "findings",
  "artifacts",
  "snapshots",
  "evidenceDigest",
  "title",
  "pullRequestNumber",
  "baseCommitSha",
  "pcbFootprintSummary",
  "pcbFootprintSummaryConsent",
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("This file is not a valid source-bound BoardReadyOps Review bundle.");
}

function validBundleHeader(envelope: RecordValue, payload: RecordValue): boolean {
  const repository = envelope.repository;
  const commitSha = envelope.commitSha;
  const evidenceDigest = payload.evidenceDigest;
  const idempotencyKey = envelope.idempotencyKey;
  if (
    envelope.format !== "boardreadyops-review-bundle-v1" ||
    typeof repository !== "string" ||
    !repositoryPattern.test(repository) ||
    typeof commitSha !== "string" ||
    !sha40.test(commitSha) ||
    typeof evidenceDigest !== "string" ||
    !sha64.test(evidenceDigest)
  )
    return false;
  return (
    payload.repositoryId === repository &&
    payload.commitSha === commitSha &&
    payload.triggerKind === "manual" &&
    typeof payload.ref === "string" &&
    payload.ref.length > 0 &&
    (envelope.uploadMode === "snapshots" || envelope.uploadMode === "metadata") &&
    typeof envelope.sourceArtIncluded === "boolean" &&
    typeof idempotencyKey === "string" &&
    idempotencyKey === `publish-${commitSha}-${evidenceDigest.slice(0, 16)}-${idempotencyKey.slice(-16)}` &&
    /^[a-f0-9]{16}$/u.test(idempotencyKey.slice(-16))
  );
}

function validPayloadShape(payload: RecordValue): boolean {
  return (
    Object.keys(payload).every((key) => permittedPayloadKeys.has(key)) &&
    !("decision" in payload) &&
    Array.isArray(payload.findings) &&
    Array.isArray(payload.snapshots) &&
    payload.snapshots.length <= 64 &&
    payload.findings.length <= 20_000 &&
    Array.isArray(payload.artifacts) &&
    payload.artifacts.length === 0
  );
}

function validPayloadMetadata(payload: RecordValue): boolean {
  return (
    (payload.title === undefined || (typeof payload.title === "string" && payload.title.length <= 256)) &&
    (payload.baseCommitSha === undefined ||
      (typeof payload.baseCommitSha === "string" && sha40.test(payload.baseCommitSha))) &&
    (payload.pullRequestNumber === undefined ||
      (Number.isInteger(payload.pullRequestNumber) && Number(payload.pullRequestNumber) > 0))
  );
}

function validFinding(finding: unknown): finding is RecordValue {
  return (
    isRecord(finding) &&
    typeof finding.ruleId === "string" &&
    typeof finding.message === "string" &&
    typeof finding.severity === "string"
  );
}

function validSnapshot(snapshot: unknown, nativeArtwork: boolean): snapshot is RecordValue {
  return (
    isRecord(snapshot) &&
    typeof snapshot.name === "string" &&
    snapshot.name.startsWith("kicad_native_") === nativeArtwork &&
    (snapshot.kind === "pcb_layer" || snapshot.kind === "schematic") &&
    typeof snapshot.sha256 === "string" &&
    sha64.test(snapshot.sha256) &&
    snapshot.format === "svg" &&
    typeof snapshot.content === "string" &&
    /<svg(?:\s|>)/iu.test(snapshot.content) &&
    Array.isArray(snapshot.anchors)
  );
}

/** Returns only the data required to preview and publish an untrusted local file. */
export function parseReviewBundle(input: unknown): ParsedReviewBundle {
  if (!isRecord(input) || !isRecord(input.payload)) invalid();
  const payload = input.payload;
  if (!validBundleHeader(input, payload) || !validPayloadShape(payload) || !validPayloadMetadata(payload)) invalid();

  const { repository, commitSha, sourceArtIncluded, idempotencyKey } = input;
  const { evidenceDigest, findings, snapshots } = payload;
  if (!Array.isArray(findings) || !Array.isArray(snapshots)) invalid();
  if (!findings.every(validFinding)) invalid();
  if (typeof sourceArtIncluded !== "boolean" || !snapshots.every((s) => validSnapshot(s, sourceArtIncluded))) invalid();

  const nativePcbViews = snapshots.filter((s) => s.kind === "pcb_layer" && sourceArtIncluded).length;
  const nativeSchematicViews = snapshots.filter((s) => s.kind === "schematic" && sourceArtIncluded).length;
  if (sourceArtIncluded && nativePcbViews + nativeSchematicViews === 0) invalid();
  if (
    typeof repository !== "string" ||
    typeof commitSha !== "string" ||
    typeof evidenceDigest !== "string" ||
    typeof idempotencyKey !== "string"
  )
    invalid();

  return {
    repository,
    commitSha,
    evidenceDigest,
    title: typeof payload.title === "string" && payload.title ? payload.title : `Review for ${commitSha.slice(0, 8)}`,
    idempotencyKey,
    findingCount: findings.length,
    blockingCount: findings.filter((f) => f.severity === "high" || f.severity === "error").length,
    nativePcbViews,
    nativeSchematicViews,
    includesDesignArtwork: sourceArtIncluded,
    payload,
  };
}
