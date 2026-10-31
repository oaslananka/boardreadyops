import { DataExportInventoryStore } from "./data-export-inventory.js";
import { type PreparedExportManifest, prepareClaimedExportManifest } from "./data-export-manifest.js";
import {
  type ClaimedRecordSnapshot,
  type ExportRecordClaim,
  prepareClaimedRunFindingSnapshot,
} from "./data-export-record-snapshot.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * Both incomplete, read-only slices are generated from the SAME PostgreSQL
 * repeatable-read snapshot and the original unexpired installation-bound claim.
 * No writes, artifact content, delivery capability or completed status.
 * Reauthorization is still required at any future publication/retrieval edge.
 */
export async function prepareClaimedConsistentMetadataSlices(
  db: Pick<PgQueryExecutor, "withTransaction">,
  claim: ExportRecordClaim,
): Promise<{ repositories: PreparedExportManifest; records: ClaimedRecordSnapshot } | null> {
  return await db.withTransaction(
    async (transaction) => {
      const repositories = await prepareClaimedExportManifest(new DataExportInventoryStore(transaction), claim);
      if (!repositories) return null;
      const records = await prepareClaimedRunFindingSnapshot(transaction, claim);
      if (!records) return null;
      return { repositories, records };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}
