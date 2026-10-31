import {
  type ClaimedExportObject,
  lookupClaimedExportObject,
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
  const initial = await lookupClaimedExportObject(input.db, input.claim, input.artifactId);
  if (!initial) return null;
  const bytes = await readVerifiedLocalExportObject({
    storageDriver: input.storageDriver,
    storageRoot: input.storageRoot,
    object: initial,
  });
  if (!bytes) return null;
  const current = await lookupClaimedExportObject(input.db, input.claim, input.artifactId);
  if (!current || JSON.stringify(current) !== JSON.stringify(initial)) return null;
  return { object: current, bytes };
}
