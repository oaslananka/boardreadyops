import {
  ExportArtifactSnapshotUnavailableError,
  prepareClaimedArtifactMetadataSnapshot,
} from "./data-export-artifact-snapshot.js";
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
 * Four incomplete, read-only slices are generated from the SAME PostgreSQL
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
  artifactMetadata: ClaimedRecordSnapshot;
} | null> {
  return await db.withTransaction(
    async (transaction) => {
      const repositories = await prepareClaimedExportManifest(new DataExportInventoryStore(transaction), claim);
      if (!repositories) return null;
      const records = await prepareClaimedRunFindingSnapshot(transaction, claim);
      if (!records) return null;
      const reviewAudit = await prepareClaimedReviewAuditSnapshot(transaction, claim);
      if (!reviewAudit) return null;
      const artifactMetadata = await prepareClaimedArtifactMetadataSnapshot(transaction, claim);
      if (!artifactMetadata) return null;

      // A metadata slice must not refer to a run missing from this same bounded
      // database snapshot. Do not return an internally incomplete package.
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
      return { repositories, records, reviewAudit, artifactMetadata };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}
