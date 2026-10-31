import {
  type ClaimedFindingCollaborationSnapshot,
  prepareClaimedFindingCollaborationSnapshot,
} from "./data-export-finding-collaboration-snapshot.js";
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
import {
  type ClaimedReviewCommentsSnapshot,
  prepareClaimedReviewCommentsSnapshot,
} from "./data-export-review-comments-snapshot.js";
import {
  type ClaimedReviewWorkflowSnapshot,
  prepareClaimedReviewWorkflowSnapshot,
} from "./data-export-review-workflow-snapshot.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * Six incomplete, read-only slices are generated from the SAME PostgreSQL
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
  reviewComments: ClaimedReviewCommentsSnapshot;
  reviewWorkflow: ClaimedReviewWorkflowSnapshot;
  findingCollaboration: ClaimedFindingCollaborationSnapshot;
} | null> {
  return await db.withTransaction(
    async (transaction) => {
      const repositories = await prepareClaimedExportManifest(new DataExportInventoryStore(transaction), claim);
      if (!repositories) return null;
      const records = await prepareClaimedRunFindingSnapshot(transaction, claim);
      if (!records) return null;
      const reviewAudit = await prepareClaimedReviewAuditSnapshot(transaction, claim);
      if (!reviewAudit) return null;
      const reviewComments = await prepareClaimedReviewCommentsSnapshot(transaction, claim);
      if (!reviewComments) return null;
      const reviewWorkflow = await prepareClaimedReviewWorkflowSnapshot(transaction, claim);
      if (!reviewWorkflow) return null;
      const findingCollaboration = await prepareClaimedFindingCollaborationSnapshot(transaction, claim);
      if (!findingCollaboration) return null;
      return { repositories, records, reviewAudit, reviewComments, reviewWorkflow, findingCollaboration };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}
