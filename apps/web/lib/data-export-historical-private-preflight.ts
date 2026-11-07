import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import {
  checkHistoricalUserArchivePrepublication,
  lookupHistoricalUserExportObject,
} from "../../../packages/db/src/data-export-historical-object-authorization.js";
import {
  inspectHistoricalUserPrivateDeliveryPreflight,
  stageHistoricalUserPrivateDeliveryPreflight,
} from "../../../packages/db/src/data-export-historical-private-preflight.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { verifyHistoricalUserPartialArchive } from "./data-export-historical-archive.js";

/**
 * PRIVATE SOURCE-ONLY boundary for one verified historical partial ZIP v3.
 * Accepting a digest supplied by a caller alone is insufficient: derive it
 * from actual locally-verified ZIP bytes, and compare the immutable contents
 * with the current ORIGINAL numeric GitHub USER's DB snapshot in the lower
 * store. This NEVER grants a customer delivery right or HTTP access.
 */
type OriginalUserAuthority = { exportId: string; verifiedGitHubUserId: number };
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[0-9a-f]{64}$/u;
const maxArchiveBytes = 64 * 1024 * 1024;
const metadataPath = "metadata/historical-core.json";
const visualPath = "metadata/historical-private-visual-evidence.json";
const receiptPath = "metadata/historical-integrity.json";

function verifiedPrivatePartialZipFingerprint(
  bytes: Buffer,
  exportId: string,
): {
  archiveSha256: string;
  archiveByteLength: number;
  coreSha256: string;
  coreByteLength: number;
  visualSha256: string;
  visualByteLength: number;
  mutationEpochSha256: string;
  visualCount: number;
  artifacts: Array<{ id: string; runId: string; sha256: string; byteLength: number; retentionExpired: boolean }>;
  runRepositories: Map<string, string>;
} | null {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maxArchiveBytes) return null;
  const archiveSha256 = sha256(bytes);
  if (!verifyHistoricalUserPartialArchive(bytes, archiveSha256, exportId)) return null;
  let extracted: ReturnType<typeof sanitizeAndExtractArchive> | null = null;
  try {
    // The independent verifier above already checked path uniqueness, the
    // receipt's per-file digests, artifact ownership, evidence and ZIP hash.
    // Re-extract ONLY to read the three exact metadata fields for DB binding.
    // These extracted Buffers are independent PRIVATE copies, never caller-owned.
    extracted = sanitizeAndExtractArchive(bytes, {
      maxCompressedSizeBytes: maxArchiveBytes,
      maxTotalExtractedBytes: maxArchiveBytes,
      maxSingleFileBytes: maxArchiveBytes,
      maxFiles: 103,
    });
    const files = new Map(extracted.files.map((file) => [file.path, file.data]));
    const core = files.get(metadataPath);
    const visual = files.get(visualPath);
    const receiptBytes = files.get(receiptPath);
    if (!core || !visual || !receiptBytes || receiptBytes.length > 32 * 1024) return null;
    const receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8")) as Record<string, unknown>;
    if (
      receipt.exportId !== exportId ||
      receipt.formatVersion !== 3 ||
      receipt.completeCustomerExport !== false ||
      receipt.scope !== "partial-preflight-not-customer-export" ||
      receipt.privateVisualContentsIncluded !== false ||
      typeof receipt.originalUserMutationEpochSha256 !== "string" ||
      !digestPattern.test(receipt.originalUserMutationEpochSha256)
    )
      return null;
    const snapshot = JSON.parse(Buffer.from(core).toString("utf8")) as {
      artifacts: Array<{ id: string; runId: string; sha256: string; byteLength: number; retentionExpired: boolean }>;
      runs: Array<{ id: string; repositoryId: string }>;
      excludedSourceClassCounts: { runSnapshots: number };
    };
    return {
      archiveSha256,
      archiveByteLength: bytes.length,
      coreSha256: sha256(core),
      coreByteLength: core.length,
      visualSha256: sha256(visual),
      visualByteLength: visual.length,
      mutationEpochSha256: receipt.originalUserMutationEpochSha256,
      visualCount: snapshot.excludedSourceClassCounts.runSnapshots,
      artifacts: snapshot.artifacts,
      runRepositories: new Map(snapshot.runs.map((run) => [run.id, run.repositoryId])),
    };
  } catch {
    return null;
  } finally {
    // The original ZIP belongs to the caller. The extracted metadata and
    // physical source copies do NOT: wipe each even on a malformed receipt,
    // failed JSON parse, or a successfully computed non-customer fingerprint.
    for (const file of extracted?.files ?? []) file.data.fill(0);
  }
}

/**
 * This is a *private* state check for verified actual ZIP v3 bytes:
 * match every current original-owner artifact locator and run the canonical
 * locked prepublication gate before staging/inspecting a diagnostic receipt.
 * A current receipt is NEVER a customer download or legal/IP authorization.
 */
async function privatePartialManifestCurrent(
  db: PgQueryExecutor,
  authority: OriginalUserAuthority,
  source: NonNullable<ReturnType<typeof verifiedPrivatePartialZipFingerprint>>,
): Promise<boolean> {
  const objects = [];
  for (const artifact of source.artifacts) {
    if (artifact.retentionExpired) return false;
    const object = await lookupHistoricalUserExportObject(db, authority, artifact.id);
    if (
      object?.artifactId !== artifact.id ||
      object.runId !== artifact.runId ||
      object.repositoryId !== source.runRepositories.get(artifact.runId) ||
      object.sha256 !== artifact.sha256 ||
      object.byteLength !== artifact.byteLength
    )
      return false;
    objects.push(object);
  }
  const gate = await checkHistoricalUserArchivePrepublication({
    db,
    authority,
    objects,
    expectedCore: { sha256: source.coreSha256, byteLength: source.coreByteLength },
    expectedVisual: {
      sha256: source.visualSha256,
      byteLength: source.visualByteLength,
      visualCount: source.visualCount,
    },
    expectedMutationEpochSha256: source.mutationEpochSha256,
  });
  return gate === "eligible";
}

export async function stageVerifiedHistoricalUserPrivateArchivePreflight(input: {
  db: PgQueryExecutor;
  authority: OriginalUserAuthority;
  archiveBytes: Buffer;
  ttlSeconds: number;
}): Promise<{ id: string } | null> {
  if (!input?.db?.withTransaction || !input?.authority || !Number.isSafeInteger(input.authority.verifiedGitHubUserId))
    return null;
  // Freeze the exact original numeric USER, export, DB and ZIP reference
  // BEFORE the first await. A caller mutation cannot shift a later DB gate
  // to another tenant while the physical archive is being inspected.
  const db = input.db;
  const authority: OriginalUserAuthority = {
    exportId: input.authority.exportId,
    verifiedGitHubUserId: input.authority.verifiedGitHubUserId,
  };
  const archiveBytes = input.archiveBytes;
  const ttlSeconds = input.ttlSeconds;
  const fingerprint = verifiedPrivatePartialZipFingerprint(archiveBytes, authority.exportId);
  if (!fingerprint || !(await privatePartialManifestCurrent(db, authority, fingerprint))) return null;
  // Archive bytes are CALLER-owned and mutable. The DB check may have
  // yielded: refuse staging any receipt after a changed original ZIP.
  if (archiveBytes.length !== fingerprint.archiveByteLength || sha256(archiveBytes) !== fingerprint.archiveSha256)
    return null;
  return stageHistoricalUserPrivateDeliveryPreflight({
    db,
    authority,
    fingerprint,
    ttlSeconds,
  });
}

/** "current" is strictly PRIVATE diagnostic state, never download approval. */
export async function inspectVerifiedHistoricalUserPrivateArchivePreflight(input: {
  db: PgQueryExecutor;
  authority: OriginalUserAuthority;
  id: string;
  archiveBytes: Buffer;
}): Promise<"current" | "stale"> {
  if (!input?.db?.withTransaction || !input?.authority || !Number.isSafeInteger(input.authority.verifiedGitHubUserId))
    return "stale";
  const db = input.db;
  const authority: OriginalUserAuthority = {
    exportId: input.authority.exportId,
    verifiedGitHubUserId: input.authority.verifiedGitHubUserId,
  };
  const archiveBytes = input.archiveBytes;
  const id = input.id;
  const fingerprint = verifiedPrivatePartialZipFingerprint(archiveBytes, authority.exportId);
  if (!fingerprint || !(await privatePartialManifestCurrent(db, authority, fingerprint))) return "stale";
  if (archiveBytes.length !== fingerprint.archiveByteLength || sha256(archiveBytes) !== fingerprint.archiveSha256)
    return "stale";
  return inspectHistoricalUserPrivateDeliveryPreflight({
    db,
    authority,
    id,
    fingerprint,
  });
}
