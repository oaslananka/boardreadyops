import {
  type ClaimedExportObject,
  lookupClaimedExportObject,
  releaseClaimedExportObjectCopy,
  reserveClaimedExportObjectCopy,
} from "@boardreadyops/db/data-export-object-authorization";
import type { ExportRecordClaim } from "@boardreadyops/db/data-export-record-snapshot";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { readVerifiedLocalExportObject } from "./data-export-local-object.js";

/**
 * A bounded, read-only INTERNAL assembly slice, not publication authority.
 * Require exactly the same server-owned claim, artifact metadata and physical
 * content before AND after IO; revocation, expired retention, a deletion
 * job or an artifact replacement fails closed. Publication needs a
 * separate atomic authorization/fencing design: this does not provide it.
 */
export async function readClaimedVerifiedLocalExportObject(input: {
  db: SqlQueryExecutor;
  claim: ExportRecordClaim;
  artifactId: string;
  storageDriver: string;
  storageRoot: string;
}): Promise<{ object: ClaimedExportObject; bytes: Buffer } | null> {
  const request = { ...input, claim: { ...input.claim } };
  const initial = await lookupClaimedExportObject(request.db, request.claim, request.artifactId);
  if (!initial || request.storageDriver !== "local") return null;
  // The SQL admission and physical unlink share a persistent path-wide fence.
  // Unlike an ordinary SELECT, this reservation survives pooled DB disconnects.
  const copyToken = await reserveClaimedExportObjectCopy(request.db, request.claim, initial);
  if (!copyToken) return null;
  let bytes: Buffer | null = null;
  let accepted = false;
  let settled = false;
  try {
    const currentBeforeRead = await lookupClaimedExportObject(request.db, request.claim, request.artifactId);
    if (!currentBeforeRead || JSON.stringify(currentBeforeRead) !== JSON.stringify(initial)) return null;
    bytes = await readVerifiedLocalExportObject({
      storageDriver: request.storageDriver,
      storageRoot: request.storageRoot,
      object: initial,
    });
    if (!bytes) return null;
    const current = await lookupClaimedExportObject(request.db, request.claim, request.artifactId);
    if (!current || JSON.stringify(current) !== JSON.stringify(initial)) return null;
    accepted = true;
    return { object: current, bytes };
  } finally {
    // Never release while IO is unresolved. A failed durable release denies
    // the pending return and also clears the temporary physical read.
    try {
      await releaseClaimedExportObjectCopy(request.db, request.claim, copyToken);
      settled = true;
    } finally {
      if (!accepted || !settled) bytes?.fill(0);
    }
  }
}
