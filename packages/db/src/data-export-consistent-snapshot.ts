import {
  ExportArtifactSnapshotUnavailableError,
  prepareClaimedArtifactMetadataSnapshot,
} from "./data-export-artifact-snapshot.js";
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
 * Seven incomplete, read-only slices are generated from the SAME PostgreSQL
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
  artifactMetadata: ClaimedRecordSnapshot;
} | null> {
  const request = { ...claim };
  const owned: Buffer[] = [];
  function own<T extends { bytes: Buffer }>(slice: T | null): T | null {
    if (slice) owned.push(slice.bytes);
    return slice;
  }

  let transferred = false;
  try {
    const result = await db.withTransaction(
      async (transaction) => {
        const repositories = own(
          await prepareClaimedExportManifest(new DataExportInventoryStore(transaction), request),
        );
        if (!repositories) return null;
        const records = own(await prepareClaimedRunFindingSnapshot(transaction, request));
        if (!records) return null;
        const reviewAudit = own(await prepareClaimedReviewAuditSnapshot(transaction, request));
        if (!reviewAudit) return null;
        const reviewComments = own(await prepareClaimedReviewCommentsSnapshot(transaction, request));
        if (!reviewComments) return null;
        const reviewWorkflow = own(await prepareClaimedReviewWorkflowSnapshot(transaction, request));
        if (!reviewWorkflow) return null;
        const findingCollaboration = own(await prepareClaimedFindingCollaborationSnapshot(transaction, request));
        if (!findingCollaboration) return null;
        const artifactMetadata = own(await prepareClaimedArtifactMetadataSnapshot(transaction, request));
        if (!artifactMetadata) return null;
        const includedRunIds = new Set(
          (JSON.parse(records.bytes.toString("utf8")) as { runs: Array<{ id: string }> }).runs.map((run) => run.id),
        );
        const artifactRows = (
          JSON.parse(artifactMetadata.bytes.toString("utf8")) as {
            artifacts: Array<{ runId: string }>;
          }
        ).artifacts;
        if (artifactRows.some((artifact) => !includedRunIds.has(artifact.runId))) {
          throw new ExportArtifactSnapshotUnavailableError();
        }
        return {
          repositories,
          records,
          reviewAudit,
          reviewComments,
          reviewWorkflow,
          findingCollaboration,
          artifactMetadata,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5_000 },
    );
    // The callback's successful return is not a successful transaction.
    // Transfer ownership only after COMMIT (and executor settlement) succeeds.
    transferred = result !== null;
    return result;
  } finally {
    if (!transferred) {
      for (const bytes of owned) bytes.fill(0);
    }
  }
}
