import { DataExportInventoryStore } from "./data-export-inventory.js";
import { type PreparedExportManifest, prepareClaimedExportManifest } from "./data-export-manifest.js";
import {
  type ClaimedRecordSnapshot,
  type ExportRecordClaim,
  prepareClaimedRunFindingSnapshot,
} from "./data-export-record-snapshot.js";
import {
  type ClaimedReviewAuditSnapshot,
  prepareClaimedReviewAuditSnapshot,
} from "./data-export-review-audit-snapshot.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * Three incomplete, read-only slices are generated from the SAME PostgreSQL
 * repeatable-read snapshot and the original unexpired installation-bound claim.
 * No writes, artifact content, delivery capability or completed status.
 * Reauthorization is still required at any future publication/retrieval edge.
 */
export async function prepareClaimedConsistentMetadataSlices(
  db: Pick<PgQueryExecutor, "withTransaction">,
  claim: ExportRecordClaim,
): Promise<{
  repositories: PreparedExportManifest;
  records: ClaimedRecordSnapshot;
  reviewAudit: ClaimedReviewAuditSnapshot;
} | null> {
  return await db.withTransaction(
    async (transaction) => {
      const repositories = await prepareClaimedExportManifest(new DataExportInventoryStore(transaction), claim);
      if (!repositories) return null;
      const records = await prepareClaimedRunFindingSnapshot(transaction, claim);
      if (!records) return null;
      const reviewAudit = await prepareClaimedReviewAuditSnapshot(transaction, claim);
      if (!reviewAudit) return null;
      return { repositories, records, reviewAudit };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}
