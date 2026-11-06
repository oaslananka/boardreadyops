import {
  type HistoricalUserObjectReadAuthority,
  lookupHistoricalUserExportObject,
  releaseHistoricalUserObjectCopy,
  reserveHistoricalUserObjectCopy,
} from "@boardreadyops/db/data-export-historical-object-authorization";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { readVerifiedLocalExportObject } from "./data-export-local-object.js";

/**
 * INTERNAL original-USER artifact byte-integrity preflight.
 * Not an HTTP route, ZIP, customer delivery capability, or export claim.
 * Caller must independently verify numeric GitHub OAuth user identity.
 * A durable shared-path fence covers all filesystem operations.
 */
export async function readVerifiedHistoricalUserLocalObject(input: {
  db: SqlQueryExecutor;
  authority: HistoricalUserObjectReadAuthority;
  artifactId: string;
  storageRoot: string;
  storageDriver: string;
}): Promise<{
  bytes: Buffer;
  exportId: string;
  artifactId: string;
  repositoryId: string;
  runId: string;
  sha256: string;
} | null> {
  if (input.storageDriver !== "local") return null;
  const initial = await lookupHistoricalUserExportObject(input.db, input.authority, input.artifactId);
  if (!initial) return null;
  const reservation = await reserveHistoricalUserObjectCopy(input.db, input.authority, initial);
  if (!reservation) return null;
  try {
    const before = await lookupHistoricalUserExportObject(input.db, input.authority, input.artifactId);
    if (!before || JSON.stringify(before) !== JSON.stringify(initial)) return null;
    const bytes = await readVerifiedLocalExportObject({
      storageRoot: input.storageRoot,
      storageDriver: input.storageDriver,
      object: initial,
    });
    if (!bytes) return null;
    const after = await lookupHistoricalUserExportObject(input.db, input.authority, input.artifactId);
    if (!after || JSON.stringify(after) !== JSON.stringify(initial)) return null;
    return {
      bytes,
      exportId: input.authority.exportId,
      artifactId: initial.artifactId,
      repositoryId: initial.repositoryId,
      runId: initial.runId,
      sha256: initial.sha256,
    };
  } finally {
    // Uncertain release fails closed; do not return bytes on settlement failure.
    await releaseHistoricalUserObjectCopy(input.db, input.authority, reservation);
  }
}
