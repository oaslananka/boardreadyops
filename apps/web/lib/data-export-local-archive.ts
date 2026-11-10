import { DataExportArchiveCommitmentStore } from "../../../packages/db/src/data-export-archive-commitment-store.js";
import { prepareClaimedConsistentMetadataSlices } from "../../../packages/db/src/data-export-consistent-snapshot.js";
import { DataExportInventoryStore } from "../../../packages/db/src/data-export-inventory.js";
import { prepareClaimedExportManifest } from "../../../packages/db/src/data-export-manifest.js";
import {
  type ClaimedExportObject,
  lookupClaimedExportObject,
} from "../../../packages/db/src/data-export-object-authorization.js";
import type { ExportRecordClaim } from "../../../packages/db/src/data-export-record-snapshot.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { ExportArchivePreflightError, type VerifiedArchiveObject } from "./data-export-archive-entries.js";
import { verifyClaimedExportArchiveIntegrity } from "./data-export-archive-integrity.js";
import { prepareClaimedArchiveZip } from "./data-export-archive-zip.js";
import { readSealedLocalExportArchive, sealLocalExportArchive } from "./data-export-local-archive-storage.js";
import { readClaimedVerifiedLocalExportObject } from "./data-export-verified-object.js";

const maxArchiveSourceBytes = 64 * 1024 * 1024;
const maxArtifacts = 100;

function sameObject(first: ClaimedExportObject, second: ClaimedExportObject): boolean {
  return (
    first.artifactId === second.artifactId &&
    first.runId === second.runId &&
    first.repositoryId === second.repositoryId &&
    first.storagePath === second.storagePath &&
    first.sha256 === second.sha256 &&
    first.byteLength === second.byteLength
  );
}

type ClaimedMetadataSlices = NonNullable<Awaited<ReturnType<typeof prepareClaimedConsistentMetadataSlices>>>;

function isValidArtifactRow(value: unknown): value is { id: string; byteLength: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { id?: unknown; byteLength?: unknown };
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.id.length <= 128 &&
    typeof row.byteLength === "number" &&
    Number.isSafeInteger(row.byteLength) &&
    row.byteLength >= 0
  );
}

/** Validate reservation and byte budget before opening physical artifacts. */
function boundedClaimedArtifactIds(slices: ClaimedMetadataSlices, exportId: string): string[] {
  try {
    const decoded = JSON.parse(slices.artifactMetadata.bytes.toString("utf8")) as {
      exportId?: unknown;
      artifacts?: unknown;
    };
    const inventory = JSON.parse(slices.repositories.bytes.toString("utf8")) as { exportId?: unknown };
    if (
      decoded?.exportId !== exportId ||
      inventory?.exportId !== exportId ||
      !Array.isArray(decoded.artifacts) ||
      decoded.artifacts.length > maxArtifacts
    ) {
      throw new ExportArchivePreflightError();
    }
    const artifactIds: string[] = [];
    const seen = new Set<string>();
    let size = Object.values(slices).reduce((sum, slice) => sum + slice.bytes.length, 0);
    for (const item of decoded.artifacts) {
      if (!isValidArtifactRow(item) || seen.has(item.id)) {
        throw new ExportArchivePreflightError();
      }
      seen.add(item.id);
      artifactIds.push(item.id);
      size += item.byteLength;
      if (!Number.isSafeInteger(size) || size > maxArchiveSourceBytes) {
        throw new ExportArchivePreflightError();
      }
    }
    return artifactIds;
  } catch (error) {
    if (error instanceof ExportArchivePreflightError) throw error;
    throw new ExportArchivePreflightError();
  }
}

/**
 * Internal read-only coordinator for a bounded local-storage ZIP.
 *
 * Every physical object is independently queried under the same worker claim
 * before/after filesystem IO. All objects are queried AGAIN after the last IO.
 * The claim and scope are rechecked from the DB before packaging; no token,
 * object storage path or download capability enters the resulting ZIP.
 *
 * This does not persist or deliver the ZIP, mark an export complete, authorize
 * a customer, survive installation removal, or implement legal-hold recovery.
 */
export async function prepareClaimedLocalArchiveZip(input: {
  db: Pick<PgQueryExecutor, "query" | "withTransaction">;
  claim: ExportRecordClaim;
  storageDriver: string;
  storageRoot: string;
}): Promise<ReturnType<typeof prepareClaimedArchiveZip> | null> {
  if (!input?.db || !input.claim || input.storageDriver !== "local" || !input.storageRoot) return null;

  const slices = await prepareClaimedConsistentMetadataSlices(input.db, input.claim);
  if (!slices) return null;

  const artifactIds = boundedClaimedArtifactIds(slices, input.claim.exportId);

  const verifiedObjects: VerifiedArchiveObject[] = [];
  for (const artifactId of artifactIds) {
    const verified = await readClaimedVerifiedLocalExportObject({
      db: input.db,
      claim: input.claim,
      artifactId,
      storageDriver: input.storageDriver,
      storageRoot: input.storageRoot,
    });
    if (!verified) return null;
    verifiedObjects.push(verified);
  }

  // Recheck earlier artifacts after all filesystem IO, not only immediately
  // after each read. Revocation or a deletion fence on a prior artifact is
  // never masked by a later successful read.
  for (const candidate of verifiedObjects) {
    const current = await lookupClaimedExportObject(input.db, input.claim, candidate.object.artifactId);
    if (!current || !sameObject(current, candidate.object)) return null;
  }

  const currentManifest = await prepareClaimedExportManifest(new DataExportInventoryStore(input.db), input.claim);
  if (!currentManifest || currentManifest.sha256 !== slices.repositories.sha256) return null;

  const archive = prepareClaimedArchiveZip({ slices, verifiedObjects });
  // ZIP construction can outlast a claim or race an external object deletion.
  // Recheck both physical-object authority and the original lease/scope after
  // packaging, before making even this internal in-memory result available.
  for (const candidate of verifiedObjects) {
    const current = await lookupClaimedExportObject(input.db, input.claim, candidate.object.artifactId);
    if (!current || !sameObject(current, candidate.object)) return null;
  }
  const afterPackaging = await prepareClaimedExportManifest(new DataExportInventoryStore(input.db), input.claim);
  if (afterPackaging?.sha256 !== slices.repositories.sha256) return null;
  return archive;
}

/**
 * INTERNAL prepare-and-stage path. Unlike a raw DB digest assertion, the
 * commitment is made ONLY after the scoped ZIP was generated, independently
 * verified against its full-byte digest, and its original claim survived all
 * post-packaging checks. The one-way DB reservation does NOT persist ZIP bytes,
 * mark a customer export completed, authorize publication or create a link.
 */
export async function stageClaimedLocalArchiveCommitment(
  input: Parameters<typeof prepareClaimedLocalArchiveZip>[0],
): Promise<{
  archive: NonNullable<Awaited<ReturnType<typeof prepareClaimedLocalArchiveZip>>>;
  expiresAt: string;
} | null> {
  const archive = await prepareClaimedLocalArchiveZip(input);
  if (!archive) return null;
  if (!verifyClaimedExportArchiveIntegrity(archive.bytes, archive.sha256, input.claim.exportId)) {
    throw new ExportArchivePreflightError();
  }
  const staged = await new DataExportArchiveCommitmentStore(input.db).stage(input.claim, archive);
  if (staged?.sha256 !== archive.sha256 || staged.byteLength !== archive.byteLength || staged.files !== archive.files) {
    return null;
  }
  return { archive, expiresAt: staged.expiresAt };
}

/**
 * Seals a local ZIP on a private, caller-provisioned 0700 filesystem BEFORE
 * accepting its one-time database commitment. A crash before DB staging can
 * leave private orphan bytes; no customer download or completed transition
 * exists, and a later retention worker must reconcile these files.
 *
 * Do not expose this API as a customer route: retrieval needs fresh original
 * requester authorization, revocation fencing and audited delivery.
 */
export async function stageClaimedDurableLocalArchiveCommitment(
  input: Parameters<typeof prepareClaimedLocalArchiveZip>[0] & { privateArchiveRoot: string },
): Promise<{ sha256: string; byteLength: number; files: number; expiresAt: string } | null> {
  const archive = await prepareClaimedLocalArchiveZip(input);
  if (!archive) return null;
  const sealed = await sealLocalExportArchive({
    archiveRoot: input.privateArchiveRoot,
    exportId: input.claim.exportId,
    archive,
  });
  if (sealed?.sha256 !== archive.sha256 || sealed.byteLength !== archive.byteLength) return null;
  const staged = await new DataExportArchiveCommitmentStore(input.db).stage(input.claim, archive);
  if (staged?.sha256 !== archive.sha256 || staged.byteLength !== archive.byteLength || staged.files !== archive.files)
    return null;
  return { ...staged };
}

/**
 * INTERNAL source for a future audited HTTP retrieval edge. A file on disk,
 * even with the correct hash, does not authorize a customer: check live
 * original-requester/tenant/installation/lease/revocation before and after IO.
 * The final read admission is atomically audited, but this method does not
 * issue an HTTP response, audit a completed download, hold a revocation fence
 * during streaming, or grant post-uninstall access.
 */
export async function readAuthorizedSealedLocalExportArchive(input: {
  db: Pick<PgQueryExecutor, "query">;
  archiveRoot: string;
  exportId: string;
  tenantId: string;
  installationId: string;
  actorLogin: string;
}): Promise<Buffer | null> {
  const store = new DataExportArchiveCommitmentStore(input.db);
  const request = {
    exportId: input.exportId,
    tenantId: input.tenantId,
    installationId: input.installationId,
    actorLogin: input.actorLogin,
  };
  const first = await store.readForRequester(request);
  if (!first) return null;
  const bytes = await readSealedLocalExportArchive({
    archiveRoot: input.archiveRoot,
    exportId: input.exportId,
    sha256: first.sha256,
    byteLength: first.byteLength,
  });
  if (!bytes) return null;
  const last = await store.auditVerifiedReadForRequester(request, first);
  if (
    last?.sha256 !== first.sha256 ||
    last.byteLength !== first.byteLength ||
    last.files !== first.files ||
    last.expiresAt !== first.expiresAt
  ) {
    return null;
  }
  return bytes;
}

/**
 * Internal chunked ZIP transport adapter (NOT a customer HTTP endpoint).
 *
 * Wait for each sink acknowledgement before sending the next bounded chunk,
 * preserving backpressure and the existing PostgreSQL revocation fence.
 * Abort and deadline are checked before/after every awaited write. Sink writes
 * MUST settle on disconnect; never race an in-flight write against a timeout
 * and release the DB lock while the sink might still deliver bytes.
 *
 * A future route must own the authenticated session, response cancellation,
 * same-origin policy, storage configuration, and delivery receipt separately.
 */
export async function consumeAuthorizedSealedLocalExportArchiveChunks(
  input: Parameters<typeof consumeAuthorizedSealedLocalExportArchive>[0] & {
    signal?: AbortSignal;
  },
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  finishResponse?: () => Promise<void>,
): Promise<boolean> {
  if (!input?.db?.withTransaction || typeof writeChunk !== "function") return false;
  const deadline = Date.now() + 25_000;
  const checkTransfer = () => {
    if (input.signal?.aborted) throw new Error("ZIP transfer aborted");
    if (Date.now() >= deadline) throw new Error("ZIP transfer deadline exceeded");
  };
  checkTransfer();
  return consumeAuthorizedSealedLocalExportArchive(input, async (bytes) => {
    const chunkBytes = 16 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      checkTransfer();
      // Own each bounded chunk; never pass a view of the full private buffer.
      const chunk = Uint8Array.from(bytes.subarray(offset, offset + chunkBytes));
      await writeChunk(chunk);
      checkTransfer();
    }
    // The HTTP finish callback must settle while the DB revocation lock
    // remains held; a rejected finish rolls back the verified-read audit.
    if (finishResponse) {
      await finishResponse();
      checkTransfer();
    }
  });
}

/**
 * Internal transactional transfer fence for a future bounded ZIP response.
 *
 * The final verified-read audit takes a PostgreSQL FOR SHARE lock on the
 * commitment; keeping the SAME transaction open through the consumer callback
 * makes concurrent requester revocation wait until the callback finishes.
 * Exceptions roll back the read audit. A caller MUST complete its bounded
 * consumption inside the callback, not capture bytes for later async use.
 *
 * No HTTP handler is wired here: session cancellation, delivery receipts and
 * transport/backpressure must be reviewed separately before customer release.
 */
export async function consumeAuthorizedSealedLocalExportArchive(
  input: Omit<Parameters<typeof readAuthorizedSealedLocalExportArchive>[0], "db"> & {
    db: Pick<PgQueryExecutor, "withTransaction">;
  },
  consume: (bytes: Buffer) => Promise<void>,
): Promise<boolean> {
  if (!input?.db?.withTransaction || typeof consume !== "function") return false;
  return input.db.withTransaction(
    async (tx) => {
      const bytes = await readAuthorizedSealedLocalExportArchive({ ...input, db: tx });
      if (!bytes) return false;
      await consume(bytes);
      return true;
    },
    { statementTimeoutMs: 30_000 },
  );
}
