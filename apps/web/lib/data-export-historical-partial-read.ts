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
  const reservation = await reserveHistoricalUserPrivatePartialRead(input.db, binding);
  if (!reservation) return null;
  let current = false;
  try {
    const bytes = await readSealedHistoricalUserPartial({
      archiveRoot: input.archiveRoot,
      exportId: binding.exportId,
      sha256: binding.sha256,
      byteLength: binding.byteLength,
    });
    if (bytes) {
      try {
        current =
          (await inspectVerifiedHistoricalUserPrivateArchivePreflight({
            db: input.db,
            authority: input.authority,
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
  // An unresolved release means the failed read remains a durable blocker.
  const settled = await releaseHistoricalUserPrivatePartialRead(input.db, {
    ...binding,
    token: reservation.token,
  });
  if (!current || !settled) return null;
  return {
    sha256: binding.sha256,
    byteLength: binding.byteLength,
    completeCustomerExport: false,
    customerDeliveryAllowed: false,
  };
}
