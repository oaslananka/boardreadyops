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
import { prepareClaimedArchiveZip } from "./data-export-archive-zip.js";
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

  let artifactIds: string[];
  try {
    const decoded = JSON.parse(slices.artifactMetadata.bytes.toString("utf8")) as {
      exportId?: unknown;
      artifacts?: Array<{ id?: unknown; byteLength?: unknown }>;
    };
    const inventory = JSON.parse(slices.repositories.bytes.toString("utf8")) as { exportId?: unknown };
    if (
      decoded?.exportId !== input.claim.exportId ||
      inventory?.exportId !== input.claim.exportId ||
      !Array.isArray(decoded.artifacts) ||
      decoded.artifacts.length > maxArtifacts
    ) {
      throw new ExportArchivePreflightError();
    }
    let size = Object.values(slices).reduce((sum, slice) => sum + slice.bytes.length, 0);
    artifactIds = [];
    const seen = new Set<string>();
    for (const item of decoded.artifacts) {
      if (
        !item ||
        typeof item.id !== "string" ||
        item.id.length === 0 ||
        item.id.length > 128 ||
        seen.has(item.id) ||
        typeof item.byteLength !== "number" ||
        !Number.isSafeInteger(item.byteLength) ||
        item.byteLength < 0
      ) {
        throw new ExportArchivePreflightError();
      }
      seen.add(item.id);
      artifactIds.push(item.id);
      size += item.byteLength;
      if (!Number.isSafeInteger(size) || size > maxArchiveSourceBytes) {
        throw new ExportArchivePreflightError();
      }
    }
  } catch (error) {
    if (error instanceof ExportArchivePreflightError) throw error;
    throw new ExportArchivePreflightError();
  }

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
  return prepareClaimedArchiveZip({ slices, verifiedObjects });
}
