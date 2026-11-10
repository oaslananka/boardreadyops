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
  if (input?.storageDriver !== "local" || !input.authority) return null;
  // Freeze caller-owned identifiers AND trusted local storage configuration
  // before the first async DB lookup. Never allow a mutable authority object
  // to switch the original numeric USER after reservation/physical IO.
  const db = input.db;
  const authority: HistoricalUserObjectReadAuthority = {
    exportId: input.authority.exportId,
    verifiedGitHubUserId: input.authority.verifiedGitHubUserId,
  };
  const artifactId = input.artifactId;
  const storageRoot = input.storageRoot;
  const storageDriver = input.storageDriver;
  const initial = await lookupHistoricalUserExportObject(db, authority, artifactId);
  if (!initial) return null;
  const reservation = await reserveHistoricalUserObjectCopy(db, authority, initial);
  if (!reservation) return null;
  let bytes: Buffer | null = null;
  let verified = false;
  let settled = false;
  try {
    const before = await lookupHistoricalUserExportObject(db, authority, artifactId);
    if (!before || JSON.stringify(before) !== JSON.stringify(initial)) return null;
    bytes = await readVerifiedLocalExportObject({
      storageRoot,
      storageDriver,
      object: initial,
    });
    if (!bytes) return null;
    const after = await lookupHistoricalUserExportObject(db, authority, artifactId);
    if (!after || JSON.stringify(after) !== JSON.stringify(initial)) return null;
    verified = true;
    return {
      bytes,
      exportId: authority.exportId,
      artifactId: initial.artifactId,
      repositoryId: initial.repositoryId,
      runId: initial.runId,
      sha256: initial.sha256,
    };
  } finally {
    try {
      // Uncertain release fails closed; do not return bytes on settlement failure.
      await releaseHistoricalUserObjectCopy(db, authority, reservation);
      settled = true;
    } finally {
      // Transfer buffer ownership only after both final source authorization
      // and durable reservation settlement succeeded.
      if (!verified || !settled) bytes?.fill(0);
    }
  }
}
