import {
  releaseHistoricalUserPrivatePartialRead,
  reserveHistoricalUserPrivatePartialRead,
} from "../../../packages/db/src/data-export-historical-partial-read.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { readSealedHistoricalUserPartial } from "./data-export-historical-partial-storage.js";
import { inspectVerifiedHistoricalUserPrivateArchivePreflight } from "./data-export-historical-private-preflight.js";

type Binding = {
  exportId: string;
  verifiedGitHubUserId: number;
  preflightId: string;
  sha256: string;
  byteLength: number;
};

/**
 * SOURCE-ONLY internal verification, NEVER a customer ZIP, bearer capability,
 * external delivery URL, streaming endpoint or full disclosure signature.
 * A persisted original-user/preflight-bound reader reservation must COMMIT
 * before file IO; it remains open during the independent ZIP+SHA check and
 * original-user DB/physical-manifest revalidation. A reservation is released
 * only after ALL read work has ended, even on rejection. No stale/failed
 * cleanup may unlink the file while this reservation remains unresolved.
 *
 * This returns ONLY a private non-customer receipt, not the archive bytes.
 * Missing DB, provider errors and failures to durably release deny. A
 * crashed reader remains unresolved indefinitely; no unsafe TTL release.
 */
export async function verifyReservedHistoricalUserPrivatePartial(input: {
  db: PgQueryExecutor;
  archiveRoot: string;
  authority: { exportId: string; verifiedGitHubUserId: number };
  preflightId: string;
  sha256: string;
  byteLength: number;
}): Promise<{
  sha256: string;
  byteLength: number;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
} | null> {
  if (!input?.db?.withTransaction || !input?.db?.query || !input?.authority) return null;
  const binding: Binding = {
    exportId: input.authority.exportId,
    verifiedGitHubUserId: input.authority.verifiedGitHubUserId,
    preflightId: input.preflightId,
    sha256: input.sha256,
    byteLength: input.byteLength,
  };
  // Every downstream DB/ZIP operation must use this SAME frozen original
  // numeric USER and exact export binding, not the caller's mutable object.
  const authority = { exportId: binding.exportId, verifiedGitHubUserId: binding.verifiedGitHubUserId };
  const db = input.db;
  const archiveRoot = input.archiveRoot;
  let reservation: Awaited<ReturnType<typeof reserveHistoricalUserPrivatePartialRead>>;
  try {
    reservation = await reserveHistoricalUserPrivatePartialRead(db, binding);
  } catch {
    // Do not disclose database/provider exceptions or attempt file IO when
    // no committed reservation is known to exist.
    return null;
  }
  if (!reservation) return null;
  let current = false;
  try {
    const bytes = await readSealedHistoricalUserPartial({
      archiveRoot,
      exportId: binding.exportId,
      sha256: binding.sha256,
      byteLength: binding.byteLength,
    });
    if (bytes) {
      try {
        current =
          (await inspectVerifiedHistoricalUserPrivateArchivePreflight({
            db,
            authority,
            id: binding.preflightId,
            archiveBytes: bytes,
          })) === "current";
      } finally {
        bytes.fill(0);
      }
    }
  } catch {
    current = false;
  }
  // A thrown or unacknowledged release must NOT leak provider details or
  // yield a private receipt. The durable unresolved reservation continues
  // blocking cooperative cleanup, including cross-worker deletion.
  let settled = false;
  try {
    settled = await releaseHistoricalUserPrivatePartialRead(db, {
      ...binding,
      token: reservation.token,
    });
  } catch {
    return null;
  }
  if (!current || !settled) return null;
  return {
    sha256: binding.sha256,
    byteLength: binding.byteLength,
    completeCustomerExport: false,
    customerDeliveryAllowed: false,
  };
}
